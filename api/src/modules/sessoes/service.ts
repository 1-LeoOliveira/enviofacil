import { consultar, consultarUm, executar, type PoolConnection, type RowDataPacket } from '../../db/pool';
import { decifrarTexto } from '../../lib/crypto';
import { erros } from '../../lib/errors';
import type { UsuarioAutenticado } from '../../middleware/auth';

export type StatusSessao =
  | 'AGUARDANDO'
  | 'ACESSADA'
  | 'EM_ANDAMENTO'
  | 'EM_ANALISE'
  | 'CONCLUIDA'
  | 'EXPIRADA'
  | 'CANCELADA';

export type StatusDocumento =
  | 'PENDENTE'
  | 'ANEXADO'
  | 'ENVIADO'
  | 'EM_ANALISE'
  | 'APROVADO'
  | 'REJEITADO'
  | 'AGUARDANDO_NOVO_ENVIO';

export const STATUS_ENCERRADOS: StatusSessao[] = ['CONCLUIDA', 'EXPIRADA', 'CANCELADA'];

export interface LinhaSessao extends RowDataPacket {
  id: string;
  codigo_curto: string;
  cpf_cipher: Buffer;
  cpf_mascarado: string;
  cidadao_nome: string;
  origem_identificacao: string;
  tipo_atendimento_id: number;
  tipo_nome: string;
  tipo_codigo: string;
  atendente_id: number;
  atendente_nome: string;
  unidade_id: number;
  unidade_nome: string;
  unidade_sigla: string;
  guiche_id: number | null;
  guiche_identificacao: string | null;
  status: StatusSessao;
  observacoes: string | null;
  motivo_encerramento: string | null;
  criado_em: Date;
  expira_em: Date;
  primeiro_acesso_em: Date | null;
  enviado_em: Date | null;
  encerrado_em: Date | null;
}

const SELECT_SESSAO = `
  SELECT s.id, s.codigo_curto, s.cpf_cipher, s.cpf_mascarado, s.cidadao_nome,
         s.origem_identificacao, s.tipo_atendimento_id, t.nome AS tipo_nome, t.codigo AS tipo_codigo,
         s.atendente_id, u.nome AS atendente_nome,
         s.unidade_id, un.nome AS unidade_nome, un.sigla AS unidade_sigla,
         s.guiche_id, g.identificacao AS guiche_identificacao,
         s.status, s.observacoes, s.motivo_encerramento,
         s.criado_em, s.expira_em, s.primeiro_acesso_em, s.enviado_em, s.encerrado_em
    FROM sessoes s
    JOIN tipos_atendimento t ON t.id = s.tipo_atendimento_id
    JOIN usuarios u ON u.id = s.atendente_id
    JOIN unidades un ON un.id = s.unidade_id
    LEFT JOIN guiches g ON g.id = s.guiche_id
`;

export async function buscarSessaoPorId(sessaoId: string): Promise<LinhaSessao | null> {
  return consultarUm<LinhaSessao>(`${SELECT_SESSAO} WHERE s.id = ?`, [sessaoId]);
}

export async function buscarSessaoPorTokenHash(tokenHash: string): Promise<LinhaSessao | null> {
  return consultarUm<LinhaSessao>(`${SELECT_SESSAO} WHERE s.token_hash = ?`, [tokenHash]);
}

export async function buscarSessaoPorCodigo(codigo: string): Promise<LinhaSessao | null> {
  return consultarUm<LinhaSessao>(`${SELECT_SESSAO} WHERE s.codigo_curto = ?`, [codigo]);
}

/**
 * Isolamento de dados por perfil, aplicado no servidor:
 * atendente vê as próprias sessões, supervisor vê a unidade, admin vê tudo.
 */
export function podeAcessarSessao(usuario: UsuarioAutenticado, sessao: LinhaSessao): boolean {
  if (usuario.perfil === 'ADMIN') return true;
  if (usuario.perfil === 'SUPERVISOR') return sessao.unidade_id === usuario.unidadeId;
  return sessao.atendente_id === usuario.id;
}

export async function carregarSessaoDoServidor(
  sessaoId: string,
  usuario: UsuarioAutenticado,
): Promise<LinhaSessao> {
  const sessao = await buscarSessaoPorId(sessaoId);
  if (!sessao) throw erros.naoEncontrado('Sessão de atendimento não encontrada.');
  if (!podeAcessarSessao(usuario, sessao)) {
    throw erros.semPermissao('Esta sessão pertence a outro atendimento.');
  }
  return sessao;
}

/** Só o atendente responsável (ou um ADMIN) altera o andamento da sessão. */
export function exigirResponsavel(usuario: UsuarioAutenticado, sessao: LinhaSessao): void {
  if (usuario.perfil === 'ADMIN') return;
  if (sessao.atendente_id !== usuario.id) {
    throw erros.semPermissao('Apenas o atendente responsável pode alterar esta sessão.');
  }
}

export function exigirSessaoAberta(sessao: LinhaSessao): void {
  if (STATUS_ENCERRADOS.includes(sessao.status)) {
    throw erros.conflito(`A sessão está ${sessao.status.toLowerCase()} e não aceita alterações.`);
  }
  if (sessao.expira_em.getTime() <= Date.now()) {
    throw erros.conflito('O prazo desta sessão expirou. Prorrogue ou crie um novo atendimento.');
  }
}

export function revelarCpf(sessao: LinhaSessao): string {
  return decifrarTexto(sessao.cpf_cipher);
}

// ------------------------------------------------------------------ documentos

export interface LinhaDocumento extends RowDataPacket {
  id: number;
  sessao_id: string;
  documento_exigido_id: number | null;
  nome: string;
  descricao: string | null;
  obrigatorio: number;
  ordem: number;
  status: StatusDocumento;
  motivo_rejeicao: string | null;
  orientacao: string | null;
  analisado_em: Date | null;
  analista_nome: string | null;
}

export interface LinhaArquivo extends RowDataPacket {
  id: string;
  sessao_id: string;
  sessao_documento_id: number | null;
  origem: 'CIDADAO' | 'ATENDENTE';
  titulo: string | null;
  descricao: string | null;
  nome_original: string;
  mime: string;
  tamanho_bytes: number;
  sha256: string;
  enviado_em: Date | null;
  criado_em: Date;
  criado_por_usuario: number | null;
  substituido: number;
}

export async function listarDocumentos(sessaoId: string): Promise<LinhaDocumento[]> {
  return consultar<LinhaDocumento>(
    `SELECT d.id, d.sessao_id, d.documento_exigido_id, d.nome, d.descricao, d.obrigatorio,
            d.ordem, d.status, d.motivo_rejeicao, d.orientacao, d.analisado_em,
            ua.nome AS analista_nome
       FROM sessao_documentos d
       LEFT JOIN usuarios ua ON ua.id = d.analisado_por
      WHERE d.sessao_id = ?
      ORDER BY d.ordem, d.id`,
    [sessaoId],
  );
}

export async function listarArquivos(sessaoId: string): Promise<LinhaArquivo[]> {
  return consultar<LinhaArquivo>(
    `SELECT id, sessao_id, sessao_documento_id, origem, titulo, descricao, nome_original,
            mime, tamanho_bytes, sha256, enviado_em, criado_em, criado_por_usuario, substituido
       FROM arquivos
      WHERE sessao_id = ? AND excluido_em IS NULL
      ORDER BY criado_em`,
    [sessaoId],
  );
}

export async function buscarDocumento(
  sessaoId: string,
  documentoId: number,
): Promise<LinhaDocumento> {
  const documento = await consultarUm<LinhaDocumento>(
    `SELECT d.id, d.sessao_id, d.documento_exigido_id, d.nome, d.descricao, d.obrigatorio,
            d.ordem, d.status, d.motivo_rejeicao, d.orientacao, d.analisado_em, NULL AS analista_nome
       FROM sessao_documentos d
      WHERE d.id = ? AND d.sessao_id = ?`,
    [documentoId, sessaoId],
  );
  if (!documento) throw erros.naoEncontrado('Documento não encontrado nesta sessão.');
  return documento;
}

// --------------------------------------------------------------------- eventos

export interface LinhaEvento extends RowDataPacket {
  id: number;
  tipo: string;
  ator: 'CIDADAO' | 'ATENDENTE' | 'SISTEMA';
  usuario_id: number | null;
  mensagem: string | null;
  dados: unknown;
  criado_em: Date;
}

export async function registrarEvento(
  sessaoId: string,
  evento: {
    tipo: string;
    ator: 'CIDADAO' | 'ATENDENTE' | 'SISTEMA';
    usuarioId?: number | null;
    mensagem?: string | null;
    dados?: Record<string, unknown>;
  },
  conexao?: PoolConnection,
): Promise<void> {
  const sql = `INSERT INTO eventos_sessao (sessao_id, tipo, ator, usuario_id, mensagem, dados)
               VALUES (?, ?, ?, ?, ?, ?)`;
  const params = [
    sessaoId,
    evento.tipo,
    evento.ator,
    evento.usuarioId ?? null,
    evento.mensagem ?? null,
    evento.dados ? JSON.stringify(evento.dados) : null,
  ];
  if (conexao) await conexao.query(sql, params);
  else await executar(sql, params);
}

export async function listarEventos(sessaoId: string, limite = 100): Promise<LinhaEvento[]> {
  return consultar<LinhaEvento>(
    `SELECT id, tipo, ator, usuario_id, mensagem, dados, criado_em
       FROM eventos_sessao
      WHERE sessao_id = ?
      ORDER BY id DESC
      LIMIT ?`,
    [sessaoId, limite],
  );
}

// ------------------------------------------------------- status da sessão

/**
 * Deriva o status da sessão a partir dos documentos. Status terminais
 * (concluída, cancelada, expirada) não são recalculados.
 */
export async function recalcularStatusSessao(sessaoId: string): Promise<StatusSessao | null> {
  const sessao = await consultarUm<RowDataPacket & { status: StatusSessao; primeiro_acesso_em: Date | null }>(
    'SELECT status, primeiro_acesso_em FROM sessoes WHERE id = ?',
    [sessaoId],
  );
  if (!sessao) return null;
  if (STATUS_ENCERRADOS.includes(sessao.status)) return sessao.status;

  const documentos = await consultar<RowDataPacket & { status: StatusDocumento; obrigatorio: number }>(
    'SELECT status, obrigatorio FROM sessao_documentos WHERE sessao_id = ?',
    [sessaoId],
  );

  const obrigatorios = documentos.filter((d) => d.obrigatorio === 1);
  const enviados = (d: { status: StatusDocumento }) =>
    ['ENVIADO', 'EM_ANALISE', 'APROVADO'].includes(d.status);

  let novo: StatusSessao;
  if (obrigatorios.length && obrigatorios.every((d) => d.status === 'APROVADO')) {
    novo = 'EM_ANALISE';
  } else if (obrigatorios.length && obrigatorios.every(enviados)) {
    novo = 'EM_ANALISE';
  } else if (documentos.some((d) => d.status !== 'PENDENTE')) {
    novo = 'EM_ANDAMENTO';
  } else if (sessao.primeiro_acesso_em) {
    novo = 'ACESSADA';
  } else {
    novo = 'AGUARDANDO';
  }

  if (novo !== sessao.status) {
    await executar('UPDATE sessoes SET status = ? WHERE id = ?', [novo, sessaoId]);
  }
  return novo;
}

export interface ProgressoSessao {
  total: number;
  obrigatorios: number;
  enviados: number;
  aprovados: number;
  rejeitados: number;
  pendentes: number;
  percentual: number;
}

export function calcularProgresso(documentos: LinhaDocumento[]): ProgressoSessao {
  const total = documentos.length;
  const enviados = documentos.filter((d) =>
    ['ENVIADO', 'EM_ANALISE', 'APROVADO'].includes(d.status),
  ).length;
  const aprovados = documentos.filter((d) => d.status === 'APROVADO').length;
  const rejeitados = documentos.filter((d) =>
    ['REJEITADO', 'AGUARDANDO_NOVO_ENVIO'].includes(d.status),
  ).length;
  const pendentes = documentos.filter((d) => ['PENDENTE', 'ANEXADO'].includes(d.status)).length;
  return {
    total,
    obrigatorios: documentos.filter((d) => d.obrigatorio === 1).length,
    enviados,
    aprovados,
    rejeitados,
    pendentes,
    percentual: total ? Math.round((enviados / total) * 100) : 0,
  };
}

// -------------------------------------------------------- serialização (API)

export interface SessaoApi {
  id: string;
  codigoCurto: string;
  cidadaoNome: string;
  cpfMascarado: string;
  origemIdentificacao: string;
  tipoAtendimento: { id: number; nome: string; codigo: string };
  atendente: { id: number; nome: string };
  unidade: { id: number; nome: string; sigla: string };
  guiche: { id: number; identificacao: string } | null;
  status: StatusSessao;
  observacoes: string | null;
  motivoEncerramento: string | null;
  criadoEm: string;
  expiraEm: string;
  primeiroAcessoEm: string | null;
  enviadoEm: string | null;
  encerradoEm: string | null;
  expirada: boolean;
  minutosRestantes: number;
}

export function serializarSessao(s: LinhaSessao): SessaoApi {
  const restante = Math.floor((s.expira_em.getTime() - Date.now()) / 60000);
  return {
    id: s.id,
    codigoCurto: s.codigo_curto,
    cidadaoNome: s.cidadao_nome,
    cpfMascarado: s.cpf_mascarado,
    origemIdentificacao: s.origem_identificacao,
    tipoAtendimento: { id: s.tipo_atendimento_id, nome: s.tipo_nome, codigo: s.tipo_codigo },
    atendente: { id: s.atendente_id, nome: s.atendente_nome },
    unidade: { id: s.unidade_id, nome: s.unidade_nome, sigla: s.unidade_sigla },
    guiche: s.guiche_id ? { id: s.guiche_id, identificacao: s.guiche_identificacao ?? '' } : null,
    status: s.status,
    observacoes: s.observacoes,
    motivoEncerramento: s.motivo_encerramento,
    criadoEm: s.criado_em.toISOString(),
    expiraEm: s.expira_em.toISOString(),
    primeiroAcessoEm: s.primeiro_acesso_em?.toISOString() ?? null,
    enviadoEm: s.enviado_em?.toISOString() ?? null,
    encerradoEm: s.encerrado_em?.toISOString() ?? null,
    expirada: s.expira_em.getTime() <= Date.now(),
    minutosRestantes: Math.max(0, restante),
  };
}

export interface ArquivoApi {
  id: string;
  documentoId: number | null;
  origem: 'CIDADAO' | 'ATENDENTE';
  titulo: string | null;
  descricao: string | null;
  nomeOriginal: string;
  mime: string;
  tamanhoBytes: number;
  sha256: string;
  enviadoEm: string | null;
  criadoEm: string;
  substituido: boolean;
}

export function serializarArquivo(a: LinhaArquivo): ArquivoApi {
  return {
    id: a.id,
    documentoId: a.sessao_documento_id,
    origem: a.origem,
    titulo: a.titulo,
    descricao: a.descricao,
    nomeOriginal: a.nome_original,
    mime: a.mime,
    tamanhoBytes: Number(a.tamanho_bytes),
    sha256: a.sha256,
    enviadoEm: a.enviado_em?.toISOString() ?? null,
    criadoEm: a.criado_em.toISOString(),
    substituido: a.substituido === 1,
  };
}

export interface DocumentoApi {
  id: number;
  nome: string;
  descricao: string | null;
  obrigatorio: boolean;
  ordem: number;
  status: StatusDocumento;
  motivoRejeicao: string | null;
  orientacao: string | null;
  analisadoEm: string | null;
  analistaNome: string | null;
  extra: boolean;
  arquivos: ArquivoApi[];
}

export function serializarDocumentos(
  documentos: LinhaDocumento[],
  arquivos: LinhaArquivo[],
): DocumentoApi[] {
  return documentos.map((d) => ({
    id: d.id,
    nome: d.nome,
    descricao: d.descricao,
    obrigatorio: d.obrigatorio === 1,
    ordem: d.ordem,
    status: d.status,
    motivoRejeicao: d.motivo_rejeicao,
    orientacao: d.orientacao,
    analisadoEm: d.analisado_em?.toISOString() ?? null,
    analistaNome: d.analista_nome,
    extra: d.documento_exigido_id === null,
    arquivos: arquivos
      .filter((a) => a.sessao_documento_id === d.id && a.origem === 'CIDADAO')
      .map(serializarArquivo),
  }));
}

export interface DetalheSessao {
  sessao: SessaoApi;
  documentos: DocumentoApi[];
  arquivosDoAtendente: ArquivoApi[];
  progresso: ProgressoSessao;
  eventos: Array<{
    id: number;
    tipo: string;
    ator: string;
    mensagem: string | null;
    criadoEm: string;
  }>;
}

export async function montarDetalheSessao(sessao: LinhaSessao): Promise<DetalheSessao> {
  const [documentos, arquivos, eventos] = await Promise.all([
    listarDocumentos(sessao.id),
    listarArquivos(sessao.id),
    listarEventos(sessao.id, 60),
  ]);

  return {
    sessao: serializarSessao(sessao),
    documentos: serializarDocumentos(documentos, arquivos),
    arquivosDoAtendente: arquivos
      .filter((a) => a.origem === 'ATENDENTE')
      .map(serializarArquivo),
    progresso: calcularProgresso(documentos),
    eventos: eventos
      .map((e) => ({
        id: Number(e.id),
        tipo: e.tipo,
        ator: e.ator,
        mensagem: e.mensagem,
        criadoEm: e.criado_em.toISOString(),
      }))
      .reverse(),
  };
}
