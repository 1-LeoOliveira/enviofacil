import { Router } from 'express';
import { z } from 'zod';
import { consultar, consultarUm, executar, type RowDataPacket } from '../../db/pool';
import { auditar } from '../../lib/auditoria';
import { hashToken, normalizarCodigoCurto, sha256, uuid } from '../../lib/crypto';
import { assincrono, erros } from '../../lib/errors';
import { parametrosUpload } from '../../lib/parametros';
import { assinarTokenCidadao, exigirCidadao } from '../../middleware/auth';
import { limiteAcessoPortal, limiteUpload } from '../../middleware/limites';
import { receberArquivo, validarArquivo } from '../../middleware/upload';
import { validar } from '../../middleware/validar';
import { emitirAtendente, emitirSessao } from '../../realtime';
import { armazenamento } from '../../storage';
import {
  buscarDocumento,
  buscarSessaoPorCodigo,
  buscarSessaoPorId,
  buscarSessaoPorTokenHash,
  montarDetalheSessao,
  recalcularStatusSessao,
  registrarEvento,
  STATUS_ENCERRADOS,
  type LinhaSessao,
} from '../sessoes/service';

export const rotasPortal = Router();

/**
 * Portal do cidadão: sem conta, sem cadastro.
 * O acesso é feito pelo token do QR Code ou pelo código curto, e resulta em um
 * token de escopo restrito a uma única sessão.
 */

/** Uma sessão encerrada, cancelada ou expirada não aceita mais nada. */
function conferirDisponibilidade(sessao: LinhaSessao): void {
  if (STATUS_ENCERRADOS.includes(sessao.status) === false && sessao.expira_em.getTime() > Date.now()) {
    return;
  }
  if (sessao.status === 'CONCLUIDA') {
    throw erros.conflito('Este atendimento já foi concluído pelo atendente.');
  }
  if (sessao.status === 'CANCELADA') {
    throw erros.conflito('Este atendimento foi encerrado pelo atendente.');
  }
  if (sessao.status === 'EXPIRADA' || sessao.expira_em.getTime() <= Date.now()) {
    throw erros.conflito(
      'O prazo deste atendimento expirou. Peça ao atendente para gerar um novo acesso.',
    );
  }
}

async function registrarPrimeiroAcesso(sessao: LinhaSessao, req: Parameters<typeof auditar>[0]) {
  if (sessao.primeiro_acesso_em) return;
  await executar(
    `UPDATE sessoes SET primeiro_acesso_em = ?, status = CASE WHEN status = 'AGUARDANDO' THEN 'ACESSADA' ELSE status END
      WHERE id = ?`,
    [new Date(), sessao.id],
  );
  await registrarEvento(sessao.id, {
    tipo: 'sessao:acessada',
    ator: 'CIDADAO',
    mensagem: 'O cidadão acessou a sessão pelo celular.',
  });
  await auditar(req, {
    ator: 'CIDADAO',
    acao: 'PORTAL_ACESSADO',
    entidade: 'sessoes',
    entidadeId: sessao.id,
  });
  emitirSessao({
    sessaoId: sessao.id,
    evento: 'sessao:acessada',
    mensagem: 'O cidadão acessou a sessão.',
  });
  emitirAtendente(sessao.atendente_id, {
    sessaoId: sessao.id,
    evento: 'sessao:acessada',
    mensagem: `${sessao.cidadao_nome} acessou a sessão digital.`,
  });
}

const esquemaAcesso = z
  .object({
    token: z.string().min(20).max(200).optional(),
    codigo: z.string().min(6).max(12).optional(),
  })
  .refine((d) => Boolean(d.token || d.codigo), {
    message: 'Informe o token do QR Code ou o código de acesso.',
  });

rotasPortal.post(
  '/acesso',
  limiteAcessoPortal,
  validar(esquemaAcesso),
  assincrono(async (req, res) => {
    const { token, codigo } = req.body as z.infer<typeof esquemaAcesso>;

    const sessao = token
      ? await buscarSessaoPorTokenHash(hashToken(token))
      : await buscarSessaoPorCodigo(normalizarCodigoCurto(codigo ?? ''));

    if (!sessao) {
      await auditar(req, {
        ator: 'CIDADAO',
        acao: 'PORTAL_ACESSO_NEGADO',
        entidade: 'sessoes',
        resultado: 'FALHA',
        detalhes: { via: token ? 'token' : 'codigo' },
      });
      throw erros.naoEncontrado(
        'Não encontramos este atendimento. Confira o código com o atendente ou leia o QR Code novamente.',
      );
    }
    conferirDisponibilidade(sessao);
    await registrarPrimeiroAcesso(sessao, req);

    const atualizada = (await buscarSessaoPorId(sessao.id))!;
    const detalhe = await montarDetalheSessao(atualizada);

    res.json({
      cidadaoToken: assinarTokenCidadao(sessao.id, sessao.expira_em),
      ...detalhe,
    });
  }),
);

// A partir daqui tudo exige o token emitido acima, restrito a uma única sessão.
rotasPortal.use(exigirCidadao);

async function sessaoDoCidadao(sessaoId: string): Promise<LinhaSessao> {
  const sessao = await buscarSessaoPorId(sessaoId);
  if (!sessao) throw erros.naoEncontrado('Atendimento não encontrado.');
  return sessao;
}

rotasPortal.get(
  '/sessao',
  assincrono(async (req, res) => {
    const sessao = await sessaoDoCidadao(req.cidadao!.sessaoId);
    const detalhe = await montarDetalheSessao(sessao);
    res.json(detalhe);
  }),
);

// ------------------------------------------------------------ envio de arquivo

rotasPortal.post(
  '/documentos/:documentoId/arquivos',
  limiteUpload,
  validar(z.object({ documentoId: z.coerce.number().int().positive() }), 'params'),
  receberArquivo,
  assincrono(async (req, res) => {
    const sessao = await sessaoDoCidadao(req.cidadao!.sessaoId);
    conferirDisponibilidade(sessao);

    const documento = await buscarDocumento(sessao.id, Number(req.params.documentoId));
    if (documento.status === 'APROVADO') {
      throw erros.conflito('Este documento já foi aprovado pelo atendente.');
    }

    const validado = await validarArquivo(req.file);
    const limites = await parametrosUpload();

    const contagem = await consultarUm<RowDataPacket & { total: number; na_sessao: number }>(
      `SELECT
         (SELECT COUNT(*) FROM arquivos
            WHERE sessao_documento_id = ? AND substituido = 0 AND excluido_em IS NULL) AS total,
         (SELECT COUNT(*) FROM arquivos
            WHERE sessao_id = ? AND excluido_em IS NULL) AS na_sessao`,
      [documento.id, sessao.id],
    );
    if (Number(contagem?.total ?? 0) >= limites.maxArquivosPorDocumento) {
      throw erros.conflito(
        `Este documento aceita no máximo ${limites.maxArquivosPorDocumento} arquivo(s). Remova um arquivo antes de anexar outro.`,
      );
    }
    if (Number(contagem?.na_sessao ?? 0) >= limites.maxArquivosPorSessao) {
      throw erros.conflito('Limite de arquivos deste atendimento atingido.');
    }

    const gravado = await armazenamento.gravar(sessao.id, req.file!.buffer, validado.extensao);
    const arquivoId = uuid();

    await executar(
      `INSERT INTO arquivos
         (id, sessao_id, sessao_documento_id, origem, nome_original, chave_armazenamento,
          mime, tamanho_bytes, sha256, cifra_iv, cifra_tag)
       VALUES (?, ?, ?, 'CIDADAO', ?, ?, ?, ?, ?, ?, ?)`,
      [
        arquivoId,
        sessao.id,
        documento.id,
        validado.nomeOriginal,
        gravado.chave,
        validado.mime,
        validado.tamanho,
        sha256(req.file!.buffer),
        gravado.iv,
        gravado.tag,
      ],
    );

    await executar(
      `UPDATE sessao_documentos
          SET status = 'ANEXADO', motivo_rejeicao = NULL
        WHERE id = ? AND sessao_id = ?`,
      [documento.id, sessao.id],
    );

    await registrarEvento(sessao.id, {
      tipo: 'documento:anexado',
      ator: 'CIDADAO',
      mensagem: `Arquivo anexado em "${documento.nome}".`,
      dados: { documentoId: documento.id },
    });
    const status = await recalcularStatusSessao(sessao.id);

    emitirSessao({
      sessaoId: sessao.id,
      evento: 'documento:anexado',
      mensagem: `Arquivo anexado em "${documento.nome}".`,
      dados: { documentoId: documento.id, arquivoId, statusSessao: status },
    });
    emitirAtendente(sessao.atendente_id, {
      sessaoId: sessao.id,
      evento: 'documento:anexado',
      mensagem: `${sessao.cidadao_nome} anexou um arquivo em "${documento.nome}".`,
    });

    res.status(201).json({
      arquivoId,
      documentoId: documento.id,
      status: 'ANEXADO',
      nomeOriginal: validado.nomeOriginal,
      tamanhoBytes: validado.tamanho,
    });
  }),
);

/** Substituir arquivo antes do envio: o cidadão remove o que anexou. */
rotasPortal.delete(
  '/arquivos/:arquivoId',
  validar(z.object({ arquivoId: z.string().uuid() }), 'params'),
  assincrono(async (req, res) => {
    const sessao = await sessaoDoCidadao(req.cidadao!.sessaoId);
    conferirDisponibilidade(sessao);

    const arquivo = await consultarUm<
      RowDataPacket & {
        id: string;
        sessao_documento_id: number | null;
        chave_armazenamento: string;
        enviado_em: Date | null;
        origem: string;
      }
    >(
      `SELECT id, sessao_documento_id, chave_armazenamento, enviado_em, origem
         FROM arquivos
        WHERE id = ? AND sessao_id = ? AND excluido_em IS NULL`,
      [req.params.arquivoId, sessao.id],
    );
    if (!arquivo || arquivo.origem !== 'CIDADAO') {
      throw erros.naoEncontrado('Arquivo não encontrado neste atendimento.');
    }
    if (arquivo.enviado_em) {
      throw erros.conflito(
        'Este arquivo já foi enviado ao atendente e não pode ser removido. Aguarde a análise.',
      );
    }

    await armazenamento.remover(arquivo.chave_armazenamento);
    await executar('UPDATE arquivos SET excluido_em = ? WHERE id = ?', [new Date(), arquivo.id]);

    if (arquivo.sessao_documento_id) {
      const restantes = await consultarUm<RowDataPacket & { total: number }>(
        `SELECT COUNT(*) AS total FROM arquivos
          WHERE sessao_documento_id = ? AND excluido_em IS NULL AND substituido = 0`,
        [arquivo.sessao_documento_id],
      );
      if (Number(restantes?.total ?? 0) === 0) {
        await executar(
          `UPDATE sessao_documentos SET status = 'PENDENTE' WHERE id = ? AND status = 'ANEXADO'`,
          [arquivo.sessao_documento_id],
        );
      }
    }

    const status = await recalcularStatusSessao(sessao.id);
    emitirSessao({
      sessaoId: sessao.id,
      evento: 'sessao:atualizada',
      mensagem: 'O cidadão removeu um arquivo anexado.',
      dados: { arquivoId: arquivo.id, statusSessao: status },
    });
    res.status(204).end();
  }),
);

// ------------------------------------------------------------------- envio

rotasPortal.post(
  '/enviar',
  assincrono(async (req, res) => {
    const sessao = await sessaoDoCidadao(req.cidadao!.sessaoId);
    conferirDisponibilidade(sessao);

    const documentos = await consultar<
      RowDataPacket & { id: number; nome: string; obrigatorio: number; status: string; anexos: number }
    >(
      `SELECT d.id, d.nome, d.obrigatorio, d.status,
              (SELECT COUNT(*) FROM arquivos a
                 WHERE a.sessao_documento_id = d.id AND a.excluido_em IS NULL AND a.substituido = 0) AS anexos
         FROM sessao_documentos d
        WHERE d.sessao_id = ?
        ORDER BY d.ordem`,
      [sessao.id],
    );

    const faltando = documentos.filter(
      (d) =>
        d.obrigatorio === 1 &&
        Number(d.anexos) === 0 &&
        !['APROVADO'].includes(d.status),
    );
    if (faltando.length) {
      throw erros.invalido('Ainda faltam documentos obrigatórios.', {
        documentos: faltando.map((d) => ({ id: d.id, nome: d.nome })),
      });
    }

    const paraEnviar = documentos.filter((d) => d.status === 'ANEXADO' && Number(d.anexos) > 0);
    if (!paraEnviar.length) {
      throw erros.conflito('Não há documentos novos para enviar.');
    }

    const agora = new Date();
    for (const documento of paraEnviar) {
      await executar(
        `UPDATE sessao_documentos SET status = 'ENVIADO' WHERE id = ? AND sessao_id = ?`,
        [documento.id, sessao.id],
      );
      await executar(
        `UPDATE arquivos SET enviado_em = ?
          WHERE sessao_documento_id = ? AND enviado_em IS NULL AND excluido_em IS NULL`,
        [agora, documento.id],
      );
    }

    await executar('UPDATE sessoes SET enviado_em = ? WHERE id = ?', [agora, sessao.id]);
    await registrarEvento(sessao.id, {
      tipo: 'documento:enviado',
      ator: 'CIDADAO',
      mensagem: `${paraEnviar.length} documento(s) enviado(s) ao atendente.`,
      dados: { documentos: paraEnviar.map((d) => d.id) },
    });
    const status = await recalcularStatusSessao(sessao.id);

    await auditar(req, {
      ator: 'CIDADAO',
      acao: 'DOCUMENTOS_ENVIADOS',
      entidade: 'sessoes',
      entidadeId: sessao.id,
      detalhes: { quantidade: paraEnviar.length },
    });

    emitirSessao({
      sessaoId: sessao.id,
      evento: 'envio:concluido',
      mensagem: `${paraEnviar.length} documento(s) enviado(s).`,
      dados: { statusSessao: status },
    });
    emitirAtendente(sessao.atendente_id, {
      sessaoId: sessao.id,
      evento: 'envio:concluido',
      mensagem: `${sessao.cidadao_nome} enviou ${paraEnviar.length} documento(s).`,
    });

    res.json({
      enviados: paraEnviar.length,
      statusSessao: status,
      mensagem: 'Documentos enviados. Aguarde a conferência do atendente.',
    });
  }),
);
