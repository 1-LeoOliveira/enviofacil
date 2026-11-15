import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { consultarUm, executar, type RowDataPacket } from '../../db/pool';
import { auditar } from '../../lib/auditoria';
import { assinarLinkArquivo, verificarLinkArquivo } from '../../lib/crypto';
import { assincrono, erros } from '../../lib/errors';
import { exigirCidadao, exigirServidor } from '../../middleware/auth';
import { limiteDownload } from '../../middleware/limites';
import { validar } from '../../middleware/validar';
import { emitirSessao } from '../../realtime';
import { armazenamento } from '../../storage';
import { buscarSessaoPorId, podeAcessarSessao, registrarEvento } from '../sessoes/service';

export const rotasArquivos = Router();

interface LinhaArquivoCompleta extends RowDataPacket {
  id: string;
  sessao_id: string;
  sessao_documento_id: number | null;
  origem: 'CIDADAO' | 'ATENDENTE';
  titulo: string | null;
  nome_original: string;
  chave_armazenamento: string;
  mime: string;
  tamanho_bytes: number;
  cifra_iv: Buffer;
  cifra_tag: Buffer;
  excluido_em: Date | null;
}

async function carregarArquivo(arquivoId: string): Promise<LinhaArquivoCompleta> {
  const arquivo = await consultarUm<LinhaArquivoCompleta>(
    `SELECT id, sessao_id, sessao_documento_id, origem, titulo, nome_original, chave_armazenamento,
            mime, tamanho_bytes, cifra_iv, cifra_tag, excluido_em
       FROM arquivos WHERE id = ?`,
    [arquivoId],
  );
  if (!arquivo || arquivo.excluido_em) throw erros.naoEncontrado('Arquivo não encontrado.');
  return arquivo;
}

/** Aceita token de servidor ou de cidadão: a autorização real vem depois. */
function autenticacaoFlexivel(req: Request, res: Response, next: NextFunction): void {
  const cabecalho = req.headers.authorization ?? '';
  if (!cabecalho.startsWith('Bearer ')) {
    next(erros.naoAutenticado());
    return;
  }
  exigirServidor(req, res, (erroServidor?: unknown) => {
    if (!erroServidor && req.usuario) {
      next();
      return;
    }
    exigirCidadao(req, res, next);
  });
}

/**
 * Gera um link temporário assinado. Necessário porque <img> e <iframe> não
 * enviam cabeçalho Authorization; o link vale poucos minutos e só para 1 arquivo.
 */
rotasArquivos.post(
  '/:arquivoId/link',
  autenticacaoFlexivel,
  validar(z.object({ arquivoId: z.string().uuid() }), 'params'),
  assincrono(async (req, res) => {
    const arquivo = await carregarArquivo(req.params.arquivoId);
    const sessao = await buscarSessaoPorId(arquivo.sessao_id);
    if (!sessao) throw erros.naoEncontrado('Arquivo não encontrado.');

    let escopo: 'servidor' | 'cidadao';

    if (req.usuario) {
      if (!podeAcessarSessao(req.usuario, sessao)) {
        throw erros.semPermissao('Este arquivo pertence a um atendimento de outro servidor.');
      }
      escopo = 'servidor';

      // Abrir um documento enviado coloca-o em análise automaticamente.
      if (arquivo.origem === 'CIDADAO' && arquivo.sessao_documento_id) {
        const documento = await consultarUm<RowDataPacket & { status: string; nome: string }>(
          'SELECT status, nome FROM sessao_documentos WHERE id = ?',
          [arquivo.sessao_documento_id],
        );
        if (documento?.status === 'ENVIADO') {
          await executar(
            `UPDATE sessao_documentos SET status = 'EM_ANALISE', analisado_por = ? WHERE id = ?`,
            [req.usuario.id, arquivo.sessao_documento_id],
          );
          await registrarEvento(sessao.id, {
            tipo: 'documento:em-analise',
            ator: 'ATENDENTE',
            usuarioId: req.usuario.id,
            mensagem: `Documento em análise: ${documento.nome}.`,
          });
          emitirSessao({
            sessaoId: sessao.id,
            evento: 'sessao:atualizada',
            mensagem: `O atendente está analisando "${documento.nome}".`,
            dados: { documentoId: arquivo.sessao_documento_id, statusDocumento: 'EM_ANALISE' },
          });
        }
      }
    } else if (req.cidadao) {
      if (req.cidadao.sessaoId !== arquivo.sessao_id) {
        throw erros.semPermissao('Este arquivo não pertence ao seu atendimento.');
      }
      escopo = 'cidadao';
    } else {
      throw erros.naoAutenticado();
    }

    const assinatura = assinarLinkArquivo(arquivo.id, escopo, env.linkDownloadSegundos);
    const expiraEm = new Date(Date.now() + env.linkDownloadSegundos * 1000).toISOString();

    await auditar(req, {
      usuarioId: req.usuario?.id ?? null,
      ator: req.usuario ? req.usuario.perfil : 'CIDADAO',
      acao: 'ARQUIVO_LINK_GERADO',
      entidade: 'arquivos',
      entidadeId: arquivo.id,
      detalhes: { sessaoId: arquivo.sessao_id, escopo },
    });

    res.json({
      // Caminho relativo à base da API; o cliente concatena com sua baseUrl.
      url: `/arquivos/conteudo?a=${encodeURIComponent(arquivo.id)}&t=${encodeURIComponent(assinatura)}`,
      expiraEm,
      nomeOriginal: arquivo.nome_original,
      mime: arquivo.mime,
      tamanhoBytes: Number(arquivo.tamanho_bytes),
    });
  }),
);

const esquemaConteudo = z.object({
  a: z.string().uuid(),
  t: z.string().min(10),
  modo: z.enum(['inline', 'download']).default('inline'),
});

/**
 * Entrega o conteúdo decifrado. Não há autenticação por cabeçalho aqui: a
 * autorização está na assinatura do link, que é curta, de uso restrito a um
 * arquivo e verificada com comparação de tempo constante.
 */
rotasArquivos.get(
  '/conteudo',
  limiteDownload,
  validar(esquemaConteudo, 'query'),
  assincrono(async (req, res) => {
    const { a: arquivoId, t: assinatura, modo } = req.query as unknown as z.infer<typeof esquemaConteudo>;

    const verificacao = verificarLinkArquivo(arquivoId, assinatura);
    if (!verificacao.valido) {
      throw erros.naoAutenticado('Link expirado. Abra o documento novamente.');
    }

    const arquivo = await carregarArquivo(arquivoId);
    const conteudo = await armazenamento.ler(
      arquivo.chave_armazenamento,
      arquivo.cifra_iv,
      arquivo.cifra_tag,
    );

    const disposicao = modo === 'download' ? 'attachment' : 'inline';
    const nome = arquivo.nome_original.replace(/"/g, '');

    res.setHeader('Content-Type', arquivo.mime);
    res.setHeader('Content-Length', String(conteudo.length));
    res.setHeader('Content-Disposition', `${disposicao}; filename="${nome}"`);
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.end(conteudo);
  }),
);
