import { Router } from 'express';
import { z } from 'zod';
import QRCode from 'qrcode';
import { env } from '../../config/env';
import { comTransacao, consultar, consultarUm, executar, type RowDataPacket } from '../../db/pool';
import { auditar } from '../../lib/auditoria';
import {
  cifrarTexto,
  cpfValido,
  decifrarTexto,
  formatarCpf,
  gerarCodigoCurto,
  gerarTokenSessao,
  hashToken,
  hmacCpf,
  mascararCpf,
  sha256,
  somenteDigitos,
  uuid,
} from '../../lib/crypto';
import { assincrono, erros } from '../../lib/errors';
import { parametroBooleano, parametroInteiro, parametrosUpload } from '../../lib/parametros';
import { inicioDoDiaLocal } from '../../lib/datas';
import { exigirPerfil, exigirServidor } from '../../middleware/auth';
import { limiteUpload } from '../../middleware/limites';
import { receberArquivo, validarArquivo } from '../../middleware/upload';
import { validar } from '../../middleware/validar';
import { desconectarCidadaos, emitirAtendente, emitirSessao } from '../../realtime';
import { armazenamento } from '../../storage';
import {
  buscarDocumento,
  carregarSessaoDoServidor,
  exigirResponsavel,
  exigirSessaoAberta,
  montarDetalheSessao,
  recalcularStatusSessao,
  registrarEvento,
  revelarCpf,
  serializarArquivo,
  serializarSessao,
  type LinhaArquivo,
  type StatusSessao,
} from './service';
import { provedorCidadaos } from '../../integrations/cidadaos';

export const rotasSessoes = Router();

rotasSessoes.use(exigirServidor);

// ---------------------------------------------------------------- criação

const esquemaCriacao = z.object({
  cpf: z.string().min(11).max(14),
  tipoAtendimentoId: z.coerce.number().int().positive(),
  guicheId: z.coerce.number().int().positive().nullable().optional(),
  observacoes: z.string().trim().max(600).optional(),
  documentos: z
    .array(
      z.object({
        documentoExigidoId: z.coerce.number().int().positive().nullable().optional(),
        nome: z.string().trim().min(3).max(140),
        descricao: z.string().trim().max(400).optional(),
        obrigatorio: z.boolean().default(true),
      }),
    )
    .min(1, 'Selecione pelo menos um documento.')
    .max(30),
});

interface LinhaTipo extends RowDataPacket {
  id: number;
  nome: string;
  ativo: number;
}

rotasSessoes.post(
  '/',
  exigirPerfil('ATENDENTE', 'ADMIN', 'SUPERVISOR'),
  validar(esquemaCriacao),
  assincrono(async (req, res) => {
    const usuario = req.usuario!;
    const dados = req.body as z.infer<typeof esquemaCriacao>;

    if (!usuario.unidadeId) {
      throw erros.invalido(
        'Seu usuário não está vinculado a uma unidade. Procure o administrador do sistema.',
      );
    }
    const cpf = somenteDigitos(dados.cpf);
    if (!cpfValido(cpf)) throw erros.invalido('CPF inválido.');

    const tipo = await consultarUm<LinhaTipo>(
      'SELECT id, nome, ativo FROM tipos_atendimento WHERE id = ?',
      [dados.tipoAtendimentoId],
    );
    if (!tipo || !tipo.ativo) throw erros.invalido('Tipo de atendimento inválido ou inativo.');

    // O guichê precisa pertencer à unidade do atendente.
    let guicheId = dados.guicheId ?? usuario.guicheId ?? null;
    if (guicheId) {
      const guiche = await consultarUm<RowDataPacket & { id: number }>(
        'SELECT id FROM guiches WHERE id = ? AND unidade_id = ? AND ativo = 1',
        [guicheId, usuario.unidadeId],
      );
      if (!guiche) guicheId = null;
    }

    // Identificação do cidadão vem da camada de integração (nunca do corpo da requisição).
    const provedor = provedorCidadaos();
    const cidadao = await provedor.consultarPorCpf(cpf);
    if (!cidadao) {
      throw erros.naoEncontrado(
        'CPF não localizado na base consultada. Confira o número informado.',
      );
    }

    const ttlMinutos = await parametroInteiro('sessao_ttl_minutos');
    const token = gerarTokenSessao();
    const sessaoId = uuid();
    const expiraEm = new Date(Date.now() + ttlMinutos * 60_000);

    // Código curto precisa ser único: tentamos algumas vezes antes de desistir.
    let codigoCurto = gerarCodigoCurto();
    for (let i = 0; i < 5; i += 1) {
      const existe = await consultarUm<RowDataPacket & { id: string }>(
        'SELECT id FROM sessoes WHERE codigo_curto = ?',
        [codigoCurto],
      );
      if (!existe) break;
      codigoCurto = gerarCodigoCurto();
    }

    await comTransacao(async (conexao) => {
      await conexao.query(
        `INSERT INTO sessoes
           (id, token_hash, token_cipher, codigo_curto, cpf_hash, cpf_cipher, cpf_mascarado,
            cidadao_nome, origem_identificacao, tipo_atendimento_id, atendente_id, unidade_id,
            guiche_id, status, observacoes, expira_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AGUARDANDO', ?, ?)`,
        [
          sessaoId,
          hashToken(token),
          cifrarTexto(token),
          codigoCurto,
          hmacCpf(cpf),
          cifrarTexto(cpf),
          mascararCpf(cpf),
          cidadao.nome,
          cidadao.origem,
          tipo.id,
          usuario.id,
          usuario.unidadeId,
          guicheId,
          dados.observacoes ?? null,
          expiraEm,
        ],
      );

      for (const [indice, doc] of dados.documentos.entries()) {
        await conexao.query(
          `INSERT INTO sessao_documentos
             (sessao_id, documento_exigido_id, nome, descricao, obrigatorio, ordem, status)
           VALUES (?, ?, ?, ?, ?, ?, 'PENDENTE')`,
          [
            sessaoId,
            doc.documentoExigidoId ?? null,
            doc.nome,
            doc.descricao ?? null,
            doc.obrigatorio ? 1 : 0,
            indice * 10,
          ],
        );
      }

      await registrarEvento(
        sessaoId,
        {
          tipo: 'sessao:criada',
          ator: 'ATENDENTE',
          usuarioId: usuario.id,
          mensagem: `Sessão criada para ${tipo.nome}.`,
          dados: { documentos: dados.documentos.length },
        },
        conexao,
      );
    });

    await auditar(req, {
      usuarioId: usuario.id,
      ator: usuario.perfil,
      acao: 'SESSAO_CRIADA',
      entidade: 'sessoes',
      entidadeId: sessaoId,
      detalhes: {
        tipoAtendimento: tipo.nome,
        documentos: dados.documentos.length,
        origemIdentificacao: cidadao.origem,
      },
    });

    const sessao = await carregarSessaoDoServidor(sessaoId, usuario);
    const acesso = await montarAcesso(token, codigoCurto, expiraEm);

    emitirAtendente(usuario.id, {
      sessaoId,
      evento: 'sessao:atualizada',
      mensagem: 'Nova sessão criada.',
    });

    res.status(201).json({
      sessao: serializarSessao(sessao),
      acesso,
      identificacao: {
        origem: cidadao.origem,
        demonstracao: cidadao.demonstracao,
        nascimento: cidadao.nascimento ?? null,
      },
    });
  }),
);

async function montarAcesso(token: string, codigoCurto: string, expiraEm: Date) {
  const link = `${env.urlPublica}/s/${token}`;
  const qrCode = await QRCode.toDataURL(link, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 360,
    color: { dark: '#0b3a6f', light: '#ffffff' },
  });
  return { link, codigoCurto, qrCode, expiraEm: expiraEm.toISOString() };
}

// ------------------------------------------------------------------ listagem

const esquemaListagem = z.object({
  status: z.string().optional(),
  minhas: z.enum(['true', 'false']).optional(),
  busca: z.string().trim().max(120).optional(),
  de: z.string().optional(),
  ate: z.string().optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(20),
});

interface LinhaListagem extends RowDataPacket {
  id: string;
  codigo_curto: string;
  cidadao_nome: string;
  cpf_mascarado: string;
  status: StatusSessao;
  criado_em: Date;
  expira_em: Date;
  encerrado_em: Date | null;
  tipo_nome: string;
  atendente_nome: string;
  unidade_sigla: string;
  guiche_identificacao: string | null;
  total_documentos: number;
  documentos_enviados: number;
  documentos_aprovados: number;
}

rotasSessoes.get(
  '/',
  validar(esquemaListagem, 'query'),
  assincrono(async (req, res) => {
    const usuario = req.usuario!;
    const filtros = req.query as unknown as z.infer<typeof esquemaListagem>;

    const condicoes: string[] = [];
    const params: unknown[] = [];

    if (usuario.perfil === 'ATENDENTE' || filtros.minhas === 'true') {
      condicoes.push('s.atendente_id = ?');
      params.push(usuario.id);
    }
    if (usuario.perfil === 'SUPERVISOR') {
      condicoes.push('s.unidade_id = ?');
      params.push(usuario.unidadeId);
    }
    if (filtros.status) {
      const lista = filtros.status.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
      if (lista.length) {
        condicoes.push(`s.status IN (${lista.map(() => '?').join(',')})`);
        params.push(...lista);
      }
    }
    if (filtros.busca) {
      condicoes.push('(s.cidadao_nome LIKE ? OR s.codigo_curto LIKE ?)');
      params.push(`%${filtros.busca}%`, `%${filtros.busca.toUpperCase()}%`);
    }
    if (filtros.de) {
      condicoes.push('s.criado_em >= ?');
      params.push(new Date(`${filtros.de}T00:00:00Z`));
    }
    if (filtros.ate) {
      condicoes.push('s.criado_em <= ?');
      params.push(new Date(`${filtros.ate}T23:59:59Z`));
    }

    const onde = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
    const limite = filtros.porPagina;
    const deslocamento = (filtros.pagina - 1) * filtros.porPagina;

    const linhas = await consultar<LinhaListagem>(
      `SELECT s.id, s.codigo_curto, s.cidadao_nome, s.cpf_mascarado, s.status,
              s.criado_em, s.expira_em, s.encerrado_em,
              t.nome AS tipo_nome, u.nome AS atendente_nome, un.sigla AS unidade_sigla,
              g.identificacao AS guiche_identificacao,
              (SELECT COUNT(*) FROM sessao_documentos d WHERE d.sessao_id = s.id) AS total_documentos,
              (SELECT COUNT(*) FROM sessao_documentos d WHERE d.sessao_id = s.id
                 AND d.status IN ('ENVIADO','EM_ANALISE','APROVADO')) AS documentos_enviados,
              (SELECT COUNT(*) FROM sessao_documentos d WHERE d.sessao_id = s.id
                 AND d.status = 'APROVADO') AS documentos_aprovados
         FROM sessoes s
         JOIN tipos_atendimento t ON t.id = s.tipo_atendimento_id
         JOIN usuarios u ON u.id = s.atendente_id
         JOIN unidades un ON un.id = s.unidade_id
         LEFT JOIN guiches g ON g.id = s.guiche_id
         ${onde}
        ORDER BY s.criado_em DESC
        LIMIT ? OFFSET ?`,
      [...params, limite, deslocamento],
    );

    const totalLinha = await consultarUm<RowDataPacket & { total: number }>(
      `SELECT COUNT(*) AS total FROM sessoes s ${onde}`,
      params,
    );

    res.json({
      itens: linhas.map((l) => ({
        id: l.id,
        codigoCurto: l.codigo_curto,
        cidadaoNome: l.cidadao_nome,
        cpfMascarado: l.cpf_mascarado,
        status: l.status,
        criadoEm: l.criado_em.toISOString(),
        expiraEm: l.expira_em.toISOString(),
        encerradoEm: l.encerrado_em?.toISOString() ?? null,
        tipoAtendimento: l.tipo_nome,
        atendenteNome: l.atendente_nome,
        unidadeSigla: l.unidade_sigla,
        guiche: l.guiche_identificacao,
        documentos: {
          total: Number(l.total_documentos),
          enviados: Number(l.documentos_enviados),
          aprovados: Number(l.documentos_aprovados),
        },
      })),
      paginacao: {
        pagina: filtros.pagina,
        porPagina: filtros.porPagina,
        total: Number(totalLinha?.total ?? 0),
      },
    });
  }),
);

// -------------------------------------------------------------------- detalhe

const esquemaId = z.object({ id: z.string().uuid() });

rotasSessoes.get(
  '/:id',
  validar(esquemaId, 'params'),
  assincrono(async (req, res) => {
    const sessao = await carregarSessaoDoServidor(req.params.id, req.usuario!);
    res.json(await montarDetalheSessao(sessao));
  }),
);

/** Dados de acesso (QR, link e código) para reexibir ao cidadão no guichê. */
rotasSessoes.get(
  '/:id/acesso',
  validar(esquemaId, 'params'),
  assincrono(async (req, res) => {
    // Supervisor da unidade também pode reexibir o acesso ao ajudar no guichê;
    // o escopo por unidade/atendente continua valendo em carregarSessaoDoServidor.
    const sessao = await carregarSessaoDoServidor(req.params.id, req.usuario!);
    const linha = await consultarUm<RowDataPacket & { token_cipher: Buffer }>(
      'SELECT token_cipher FROM sessoes WHERE id = ?',
      [sessao.id],
    );
    if (!linha) throw erros.naoEncontrado();
    const token = decifrarTexto(linha.token_cipher);
    res.json({
      acesso: await montarAcesso(token, sessao.codigo_curto, sessao.expira_em),
      status: sessao.status,
    });
  }),
);

/** Revela o CPF completo para conferência no guichê. Operação auditada. */
rotasSessoes.post(
  '/:id/revelar-cpf',
  validar(esquemaId, 'params'),
  assincrono(async (req, res) => {
    const usuario = req.usuario!;
    const sessao = await carregarSessaoDoServidor(req.params.id, usuario);
    const cpf = revelarCpf(sessao);
    await auditar(req, {
      usuarioId: usuario.id,
      ator: usuario.perfil,
      acao: 'CPF_REVELADO',
      entidade: 'sessoes',
      entidadeId: sessao.id,
      detalhes: { motivo: 'conferencia_no_guiche' },
    });
    res.json({ cpf: formatarCpf(cpf) });
  }),
);

// ------------------------------------------------------- documentos da sessão

const esquemaDocumentoNovo = z.object({
  nome: z.string().trim().min(3).max(140),
  descricao: z.string().trim().max(400).optional(),
  obrigatorio: z.boolean().default(false),
});

rotasSessoes.post(
  '/:id/documentos',
  validar(esquemaId, 'params'),
  validar(esquemaDocumentoNovo),
  assincrono(async (req, res) => {
    const usuario = req.usuario!;
    const sessao = await carregarSessaoDoServidor(req.params.id, usuario);
    exigirResponsavel(usuario, sessao);
    exigirSessaoAberta(sessao);

    if (!(await parametroBooleano('atendente_pode_adicionar_documento'))) {
      throw erros.semPermissao(
        'A inclusão de documentos extras está desativada nas configurações da plataforma.',
      );
    }

    const dados = req.body as z.infer<typeof esquemaDocumentoNovo>;
    const ordem = await consultarUm<RowDataPacket & { proxima: number }>(
      'SELECT COALESCE(MAX(ordem), 0) + 10 AS proxima FROM sessao_documentos WHERE sessao_id = ?',
      [sessao.id],
    );

    const resultado = await executar(
      `INSERT INTO sessao_documentos (sessao_id, documento_exigido_id, nome, descricao, obrigatorio, ordem, status)
       VALUES (?, NULL, ?, ?, ?, ?, 'PENDENTE')`,
      [sessao.id, dados.nome, dados.descricao ?? null, dados.obrigatorio ? 1 : 0, Number(ordem?.proxima ?? 10)],
    );

    await registrarEvento(sessao.id, {
      tipo: 'documento:adicionado',
      ator: 'ATENDENTE',
      usuarioId: usuario.id,
      mensagem: `Documento adicionado: ${dados.nome}.`,
    });
    await recalcularStatusSessao(sessao.id);

    emitirSessao({
      sessaoId: sessao.id,
      evento: 'documento:adicionado',
      mensagem: `O atendente solicitou um documento adicional: ${dados.nome}.`,
      dados: { documentoId: resultado.insertId },
    });

    res.status(201).json({ documentoId: resultado.insertId });
  }),
);

rotasSessoes.delete(
  '/:id/documentos/:documentoId',
  validar(z.object({ id: z.string().uuid(), documentoId: z.coerce.number().int().positive() }), 'params'),
  assincrono(async (req, res) => {
    const usuario = req.usuario!;
    const sessao = await carregarSessaoDoServidor(req.params.id, usuario);
    exigirResponsavel(usuario, sessao);
    exigirSessaoAberta(sessao);

    const documento = await buscarDocumento(sessao.id, Number(req.params.documentoId));
    if (documento.documento_exigido_id !== null) {
      throw erros.conflito(
        'Documentos previstos no serviço não podem ser removidos da sessão. Marque-o como não obrigatório no catálogo.',
      );
    }
    if (documento.status !== 'PENDENTE') {
      throw erros.conflito('Só é possível remover documentos que ainda não receberam arquivos.');
    }

    await executar('DELETE FROM sessao_documentos WHERE id = ? AND sessao_id = ?', [
      documento.id,
      sessao.id,
    ]);
    await registrarEvento(sessao.id, {
      tipo: 'documento:removido',
      ator: 'ATENDENTE',
      usuarioId: usuario.id,
      mensagem: `Documento removido: ${documento.nome}.`,
    });
    await recalcularStatusSessao(sessao.id);
    emitirSessao({
      sessaoId: sessao.id,
      evento: 'documento:removido',
      mensagem: `O documento "${documento.nome}" não é mais necessário.`,
      dados: { documentoId: documento.id },
    });
    res.status(204).end();
  }),
);

// ------------------------------------------------------- análise de documentos

async function finalizarAnalise(
  sessaoId: string,
  documentoId: number,
  usuarioId: number,
  status: 'APROVADO' | 'REJEITADO' | 'AGUARDANDO_NOVO_ENVIO',
  campos: { motivo?: string | null; orientacao?: string | null },
) {
  await executar(
    `UPDATE sessao_documentos
        SET status = ?, motivo_rejeicao = ?, orientacao = ?, analisado_por = ?, analisado_em = ?
      WHERE id = ? AND sessao_id = ?`,
    [
      status,
      campos.motivo ?? null,
      campos.orientacao ?? null,
      usuarioId,
      new Date(),
      documentoId,
      sessaoId,
    ],
  );
}

rotasSessoes.post(
  '/:id/documentos/:documentoId/aprovar',
  validar(z.object({ id: z.string().uuid(), documentoId: z.coerce.number().int().positive() }), 'params'),
  assincrono(async (req, res) => {
    const usuario = req.usuario!;
    const sessao = await carregarSessaoDoServidor(req.params.id, usuario);
    exigirResponsavel(usuario, sessao);
    const documento = await buscarDocumento(sessao.id, Number(req.params.documentoId));

    if (!['ENVIADO', 'EM_ANALISE', 'REJEITADO'].includes(documento.status)) {
      throw erros.conflito('Só é possível aprovar documentos que já foram enviados pelo cidadão.');
    }

    await finalizarAnalise(sessao.id, documento.id, usuario.id, 'APROVADO', {
      motivo: null,
      orientacao: null,
    });
    await registrarEvento(sessao.id, {
      tipo: 'documento:aprovado',
      ator: 'ATENDENTE',
      usuarioId: usuario.id,
      mensagem: `Documento aprovado: ${documento.nome}.`,
    });
    const status = await recalcularStatusSessao(sessao.id);
    await auditar(req, {
      usuarioId: usuario.id,
      ator: usuario.perfil,
      acao: 'DOCUMENTO_APROVADO',
      entidade: 'sessao_documentos',
      entidadeId: documento.id,
      detalhes: { sessaoId: sessao.id },
    });

    emitirSessao({
      sessaoId: sessao.id,
      evento: 'documento:aprovado',
      mensagem: `Documento aprovado: ${documento.nome}.`,
      dados: { documentoId: documento.id, statusSessao: status },
    });
    res.json({ status: 'APROVADO' });
  }),
);

const esquemaRejeicao = z.object({
  motivo: z
    .string()
    .trim()
    .min(10, 'Descreva o motivo da rejeição com ao menos 10 caracteres - o cidadão vai ler esta mensagem.')
    .max(400),
  solicitarNovoEnvio: z.boolean().default(true),
  orientacao: z.string().trim().max(400).optional(),
});

rotasSessoes.post(
  '/:id/documentos/:documentoId/rejeitar',
  validar(z.object({ id: z.string().uuid(), documentoId: z.coerce.number().int().positive() }), 'params'),
  validar(esquemaRejeicao),
  assincrono(async (req, res) => {
    const usuario = req.usuario!;
    const dados = req.body as z.infer<typeof esquemaRejeicao>;
    const sessao = await carregarSessaoDoServidor(req.params.id, usuario);
    exigirResponsavel(usuario, sessao);
    const documento = await buscarDocumento(sessao.id, Number(req.params.documentoId));

    if (documento.status === 'PENDENTE') {
      throw erros.conflito('Este documento ainda não recebeu nenhum arquivo.');
    }

    const novoStatus = dados.solicitarNovoEnvio ? 'AGUARDANDO_NOVO_ENVIO' : 'REJEITADO';
    await finalizarAnalise(sessao.id, documento.id, usuario.id, novoStatus, {
      motivo: dados.motivo,
      orientacao: dados.orientacao ?? null,
    });
    // Os arquivos anteriores ficam marcados como substituídos, mas são preservados
    // para auditoria até o descarte pela política de retenção.
    await executar(
      'UPDATE arquivos SET substituido = 1 WHERE sessao_documento_id = ? AND origem = ?',
      [documento.id, 'CIDADAO'],
    );

    await registrarEvento(sessao.id, {
      tipo: 'documento:rejeitado',
      ator: 'ATENDENTE',
      usuarioId: usuario.id,
      mensagem: `Documento rejeitado: ${documento.nome}.`,
      dados: { motivo: dados.motivo },
    });
    const status = await recalcularStatusSessao(sessao.id);
    await auditar(req, {
      usuarioId: usuario.id,
      ator: usuario.perfil,
      acao: 'DOCUMENTO_REJEITADO',
      entidade: 'sessao_documentos',
      entidadeId: documento.id,
      detalhes: { sessaoId: sessao.id, solicitouNovoEnvio: dados.solicitarNovoEnvio },
    });

    emitirSessao({
      sessaoId: sessao.id,
      evento: dados.solicitarNovoEnvio ? 'documento:novo-envio' : 'documento:rejeitado',
      mensagem: `Não foi possível validar "${documento.nome}". ${dados.motivo}`,
      dados: { documentoId: documento.id, statusSessao: status, motivo: dados.motivo },
    });
    res.json({ status: novoStatus });
  }),
);

const esquemaOrientacao = z.object({ orientacao: z.string().trim().min(3).max(400) });

rotasSessoes.post(
  '/:id/documentos/:documentoId/orientacao',
  validar(z.object({ id: z.string().uuid(), documentoId: z.coerce.number().int().positive() }), 'params'),
  validar(esquemaOrientacao),
  assincrono(async (req, res) => {
    const usuario = req.usuario!;
    const { orientacao } = req.body as z.infer<typeof esquemaOrientacao>;
    const sessao = await carregarSessaoDoServidor(req.params.id, usuario);
    exigirResponsavel(usuario, sessao);
    exigirSessaoAberta(sessao);
    const documento = await buscarDocumento(sessao.id, Number(req.params.documentoId));

    await executar('UPDATE sessao_documentos SET orientacao = ? WHERE id = ? AND sessao_id = ?', [
      orientacao,
      documento.id,
      sessao.id,
    ]);
    await registrarEvento(sessao.id, {
      tipo: 'documento:orientacao',
      ator: 'ATENDENTE',
      usuarioId: usuario.id,
      mensagem: `Orientação sobre "${documento.nome}": ${orientacao}`,
    });
    emitirSessao({
      sessaoId: sessao.id,
      evento: 'documento:orientacao',
      mensagem: `Orientação sobre "${documento.nome}": ${orientacao}`,
      dados: { documentoId: documento.id, orientacao },
    });
    res.json({ orientacao });
  }),
);

// ------------------------------- arquivos disponibilizados pelo atendente

const esquemaArquivoAtendente = z.object({
  titulo: z.string().trim().min(3).max(140),
  descricao: z.string().trim().max(400).optional(),
});

rotasSessoes.post(
  '/:id/arquivos',
  limiteUpload,
  validar(esquemaId, 'params'),
  receberArquivo,
  assincrono(async (req, res) => {
    const usuario = req.usuario!;
    const sessao = await carregarSessaoDoServidor(req.params.id, usuario);
    exigirResponsavel(usuario, sessao);
    exigirSessaoAberta(sessao);

    const meta = esquemaArquivoAtendente.parse({
      titulo: req.body?.titulo,
      descricao: req.body?.descricao || undefined,
    });
    const validado = await validarArquivo(req.file);

    const limites = await parametrosUpload();
    const totalLinha = await consultarUm<RowDataPacket & { total: number }>(
      'SELECT COUNT(*) AS total FROM arquivos WHERE sessao_id = ? AND excluido_em IS NULL',
      [sessao.id],
    );
    if (Number(totalLinha?.total ?? 0) >= limites.maxArquivosPorSessao) {
      throw erros.conflito('Limite de arquivos desta sessão atingido.');
    }

    const gravado = await armazenamento.gravar(sessao.id, req.file!.buffer, validado.extensao);
    const arquivoId = uuid();

    await executar(
      `INSERT INTO arquivos
         (id, sessao_id, sessao_documento_id, origem, titulo, descricao, nome_original,
          chave_armazenamento, mime, tamanho_bytes, sha256, cifra_iv, cifra_tag, enviado_em, criado_por_usuario)
       VALUES (?, ?, NULL, 'ATENDENTE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        arquivoId,
        sessao.id,
        meta.titulo,
        meta.descricao ?? null,
        validado.nomeOriginal,
        gravado.chave,
        validado.mime,
        validado.tamanho,
        sha256(req.file!.buffer),
        gravado.iv,
        gravado.tag,
        new Date(),
        usuario.id,
      ],
    );

    await registrarEvento(sessao.id, {
      tipo: 'arquivo:disponibilizado',
      ator: 'ATENDENTE',
      usuarioId: usuario.id,
      mensagem: `Arquivo disponibilizado ao cidadão: ${meta.titulo}.`,
    });
    await auditar(req, {
      usuarioId: usuario.id,
      ator: usuario.perfil,
      acao: 'ARQUIVO_DISPONIBILIZADO',
      entidade: 'arquivos',
      entidadeId: arquivoId,
      detalhes: { sessaoId: sessao.id, tamanho: validado.tamanho },
    });

    emitirSessao({
      sessaoId: sessao.id,
      evento: 'arquivo:disponibilizado',
      mensagem: `O atendente disponibilizou um novo arquivo: ${meta.titulo}.`,
      dados: { arquivoId },
    });

    const arquivo = await consultarUm<LinhaArquivo>(
      `SELECT id, sessao_id, sessao_documento_id, origem, titulo, descricao, nome_original, mime,
              tamanho_bytes, sha256, enviado_em, criado_em, criado_por_usuario, substituido
         FROM arquivos WHERE id = ?`,
      [arquivoId],
    );
    res.status(201).json({ arquivo: arquivo ? serializarArquivo(arquivo) : null });
  }),
);

rotasSessoes.delete(
  '/:id/arquivos/:arquivoId',
  validar(z.object({ id: z.string().uuid(), arquivoId: z.string().uuid() }), 'params'),
  assincrono(async (req, res) => {
    const usuario = req.usuario!;
    const sessao = await carregarSessaoDoServidor(req.params.id, usuario);
    exigirResponsavel(usuario, sessao);

    const arquivo = await consultarUm<RowDataPacket & { id: string; chave_armazenamento: string; origem: string; titulo: string | null }>(
      'SELECT id, chave_armazenamento, origem, titulo FROM arquivos WHERE id = ? AND sessao_id = ? AND excluido_em IS NULL',
      [req.params.arquivoId, sessao.id],
    );
    if (!arquivo) throw erros.naoEncontrado('Arquivo não encontrado nesta sessão.');
    if (arquivo.origem !== 'ATENDENTE') {
      throw erros.conflito(
        'Arquivos enviados pelo cidadão não são apagados pelo atendente; use a rejeição do documento.',
      );
    }

    await armazenamento.remover(arquivo.chave_armazenamento);
    await executar('UPDATE arquivos SET excluido_em = ? WHERE id = ?', [new Date(), arquivo.id]);
    await registrarEvento(sessao.id, {
      tipo: 'arquivo:removido',
      ator: 'ATENDENTE',
      usuarioId: usuario.id,
      mensagem: `Arquivo removido: ${arquivo.titulo ?? ''}.`,
    });
    emitirSessao({
      sessaoId: sessao.id,
      evento: 'arquivo:removido',
      mensagem: 'Um arquivo disponibilizado foi removido pelo atendente.',
      dados: { arquivoId: arquivo.id },
    });
    res.status(204).end();
  }),
);

// ----------------------------------------------------- ciclo de vida da sessão

const esquemaEncerramento = z.object({
  motivo: z.string().trim().max(300).optional(),
});

async function encerrar(
  sessaoId: string,
  status: Extract<StatusSessao, 'CONCLUIDA' | 'CANCELADA'>,
  motivo: string | null,
) {
  await executar(
    `UPDATE sessoes SET status = ?, encerrado_em = ?, motivo_encerramento = ? WHERE id = ?`,
    [status, new Date(), motivo, sessaoId],
  );
}

rotasSessoes.post(
  '/:id/encerrar',
  validar(esquemaId, 'params'),
  validar(esquemaEncerramento),
  assincrono(async (req, res) => {
    const usuario = req.usuario!;
    const { motivo } = req.body as z.infer<typeof esquemaEncerramento>;
    const sessao = await carregarSessaoDoServidor(req.params.id, usuario);
    exigirResponsavel(usuario, sessao);
    if (['CONCLUIDA', 'CANCELADA'].includes(sessao.status)) {
      throw erros.conflito('Esta sessão já está encerrada.');
    }

    await encerrar(sessao.id, 'CONCLUIDA', motivo ?? null);
    await registrarEvento(sessao.id, {
      tipo: 'sessao:encerrada',
      ator: 'ATENDENTE',
      usuarioId: usuario.id,
      mensagem: 'Atendimento concluído pelo atendente.',
    });
    await auditar(req, {
      usuarioId: usuario.id,
      ator: usuario.perfil,
      acao: 'SESSAO_CONCLUIDA',
      entidade: 'sessoes',
      entidadeId: sessao.id,
    });

    emitirSessao({
      sessaoId: sessao.id,
      evento: 'sessao:encerrada',
      mensagem: 'Atendimento concluído. Obrigado por utilizar o Envio Fácil.',
      dados: { status: 'CONCLUIDA' },
    });
    await desconectarCidadaos(sessao.id);
    res.json({ status: 'CONCLUIDA' });
  }),
);

rotasSessoes.post(
  '/:id/cancelar',
  validar(esquemaId, 'params'),
  validar(z.object({ motivo: z.string().trim().min(3).max(300) })),
  assincrono(async (req, res) => {
    const usuario = req.usuario!;
    const { motivo } = req.body as { motivo: string };
    const sessao = await carregarSessaoDoServidor(req.params.id, usuario);
    exigirResponsavel(usuario, sessao);
    if (['CONCLUIDA', 'CANCELADA'].includes(sessao.status)) {
      throw erros.conflito('Esta sessão já está encerrada.');
    }

    await encerrar(sessao.id, 'CANCELADA', motivo);
    await registrarEvento(sessao.id, {
      tipo: 'sessao:cancelada',
      ator: 'ATENDENTE',
      usuarioId: usuario.id,
      mensagem: `Sessão cancelada: ${motivo}`,
    });
    await auditar(req, {
      usuarioId: usuario.id,
      ator: usuario.perfil,
      acao: 'SESSAO_CANCELADA',
      entidade: 'sessoes',
      entidadeId: sessao.id,
      detalhes: { motivo },
    });

    emitirSessao({
      sessaoId: sessao.id,
      evento: 'sessao:encerrada',
      mensagem: `A sessão foi encerrada pelo atendente. ${motivo}`,
      dados: { status: 'CANCELADA' },
    });
    await desconectarCidadaos(sessao.id);
    res.json({ status: 'CANCELADA' });
  }),
);

rotasSessoes.post(
  '/:id/prorrogar',
  validar(esquemaId, 'params'),
  assincrono(async (req, res) => {
    const usuario = req.usuario!;
    const sessao = await carregarSessaoDoServidor(req.params.id, usuario);
    exigirResponsavel(usuario, sessao);
    if (['CONCLUIDA', 'CANCELADA'].includes(sessao.status)) {
      throw erros.conflito('Esta sessão já está encerrada.');
    }

    const minutos = await parametroInteiro('sessao_prorrogacao_minutos');
    const base = Math.max(Date.now(), sessao.expira_em.getTime());
    const novaExpiracao = new Date(base + minutos * 60_000);
    const novoStatus: StatusSessao = sessao.status === 'EXPIRADA'
      ? (sessao.primeiro_acesso_em ? 'EM_ANDAMENTO' : 'AGUARDANDO')
      : sessao.status;

    await executar('UPDATE sessoes SET expira_em = ?, status = ? WHERE id = ?', [
      novaExpiracao,
      novoStatus,
      sessao.id,
    ]);
    await registrarEvento(sessao.id, {
      tipo: 'sessao:prorrogada',
      ator: 'ATENDENTE',
      usuarioId: usuario.id,
      mensagem: `Prazo prorrogado em ${minutos} minutos.`,
    });
    await auditar(req, {
      usuarioId: usuario.id,
      ator: usuario.perfil,
      acao: 'SESSAO_PRORROGADA',
      entidade: 'sessoes',
      entidadeId: sessao.id,
      detalhes: { minutos },
    });

    emitirSessao({
      sessaoId: sessao.id,
      evento: 'sessao:atualizada',
      mensagem: `O atendente prorrogou o prazo em ${minutos} minutos.`,
      dados: { expiraEm: novaExpiracao.toISOString() },
    });
    res.json({ expiraEm: novaExpiracao.toISOString(), status: novoStatus });
  }),
);

/** Painel inicial do atendente. */
export const rotasPainel = Router();
rotasPainel.use(exigirServidor);

rotasPainel.get(
  '/',
  assincrono(async (req, res) => {
    const usuario = req.usuario!;
    // Escopo do painel: atendente vê o próprio trabalho, supervisor a unidade,
    // administrador o conjunto da plataforma.
    let condicao = '1 = 1';
    let escopo: unknown[] = [];
    if (usuario.perfil === 'ATENDENTE') {
      condicao = 's.atendente_id = ?';
      escopo = [usuario.id];
    } else if (usuario.perfil === 'SUPERVISOR') {
      condicao = 's.unidade_id = ?';
      escopo = [usuario.unidadeId];
    }

    // "Hoje" é o dia civil da unidade, não o dia UTC do servidor.
    const inicioDoDia = inicioDoDiaLocal();

    const indicadores = await consultarUm<RowDataPacket & Record<string, number>>(
      `SELECT
         SUM(s.status IN ('AGUARDANDO','ACESSADA','EM_ANDAMENTO','EM_ANALISE')) AS em_andamento,
         SUM(s.status = 'AGUARDANDO') AS aguardando_acesso,
         SUM(s.status IN ('ACESSADA','EM_ANDAMENTO')) AS aguardando_documentos,
         SUM(s.status = 'EM_ANALISE') AS aguardando_analise,
         SUM(s.status = 'CONCLUIDA' AND s.encerrado_em >= ?) AS concluidas_hoje,
         SUM(s.status = 'CANCELADA' AND s.encerrado_em >= ?) AS canceladas_hoje
       FROM sessoes s
      WHERE ${condicao}`,
      [inicioDoDia, inicioDoDia, ...escopo],
    );

    const documentos = await consultarUm<RowDataPacket & Record<string, number>>(
      `SELECT
         COUNT(a.id) AS arquivos_recebidos,
         SUM(a.criado_em >= ?) AS arquivos_recebidos_hoje
       FROM arquivos a
       JOIN sessoes s ON s.id = a.sessao_id
      WHERE a.origem = 'CIDADAO' AND a.excluido_em IS NULL AND ${condicao}`,
      [inicioDoDia, ...escopo],
    );

    const recentes = await consultar<RowDataPacket & {
      id: string;
      cidadao_nome: string;
      status: string;
      tipo_nome: string;
      criado_em: Date;
      enviados: number;
      total: number;
    }>(
      `SELECT s.id, s.cidadao_nome, s.status, t.nome AS tipo_nome, s.criado_em,
              (SELECT COUNT(*) FROM sessao_documentos d WHERE d.sessao_id = s.id
                 AND d.status IN ('ENVIADO','EM_ANALISE','APROVADO')) AS enviados,
              (SELECT COUNT(*) FROM sessao_documentos d WHERE d.sessao_id = s.id) AS total
         FROM sessoes s
         JOIN tipos_atendimento t ON t.id = s.tipo_atendimento_id
        WHERE ${condicao}
        ORDER BY s.criado_em DESC
        LIMIT 8`,
      escopo,
    );

    res.json({
      atendente: {
        nome: usuario.nome,
        perfil: usuario.perfil,
      },
      indicadores: {
        emAndamento: Number(indicadores?.em_andamento ?? 0),
        aguardandoAcesso: Number(indicadores?.aguardando_acesso ?? 0),
        aguardandoDocumentos: Number(indicadores?.aguardando_documentos ?? 0),
        aguardandoAnalise: Number(indicadores?.aguardando_analise ?? 0),
        concluidasHoje: Number(indicadores?.concluidas_hoje ?? 0),
        canceladasHoje: Number(indicadores?.canceladas_hoje ?? 0),
        arquivosRecebidos: Number(documentos?.arquivos_recebidos ?? 0),
        arquivosRecebidosHoje: Number(documentos?.arquivos_recebidos_hoje ?? 0),
      },
      recentes: recentes.map((r) => ({
        id: r.id,
        cidadaoNome: r.cidadao_nome,
        status: r.status,
        tipoAtendimento: r.tipo_nome,
        criadoEm: r.criado_em.toISOString(),
        enviados: Number(r.enviados),
        total: Number(r.total),
      })),
    });
  }),
);
