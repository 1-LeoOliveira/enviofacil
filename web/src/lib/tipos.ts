export type Perfil = 'ADMIN' | 'SUPERVISOR' | 'ATENDENTE';

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

export interface Usuario {
  id: number;
  nome: string;
  email: string;
  perfil: Perfil;
  deveTrocarSenha: boolean;
  unidade: { id: number; nome: string; sigla: string } | null;
  guiche: { id: number; identificacao: string } | null;
}

export interface Arquivo {
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

export interface DocumentoSessao {
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
  arquivos: Arquivo[];
}

export interface Sessao {
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

export interface Progresso {
  total: number;
  obrigatorios: number;
  enviados: number;
  aprovados: number;
  rejeitados: number;
  pendentes: number;
  percentual: number;
}

export interface EventoSessao {
  id: number;
  tipo: string;
  ator: string;
  mensagem: string | null;
  criadoEm: string;
}

export interface DetalheSessao {
  sessao: Sessao;
  documentos: DocumentoSessao[];
  arquivosDoAtendente: Arquivo[];
  progresso: Progresso;
  eventos: EventoSessao[];
}

export interface AcessoSessao {
  link: string;
  codigoCurto: string;
  qrCode: string;
  expiraEm: string;
}

export interface TipoAtendimento {
  id: number;
  codigo: string;
  nome: string;
  descricao: string | null;
  categoria: 'VEICULO' | 'HABILITACAO' | 'ADMINISTRATIVO';
  documentos: Array<{
    id: number;
    nome: string;
    descricao: string | null;
    obrigatorio: boolean;
    ordem: number;
  }>;
}

export interface UsuarioDemonstracao {
  id: number;
  nome: string;
  perfil: Perfil;
  unidadeSigla: string | null;
}

export interface ParametrosPublicos {
  upload: { tamanhoMaximoMb: number; maxArquivosPorDocumento: number; formatos: string[] };
  ambiente: { demonstracao: boolean; provedorIdentificacao: string };
  /** Presente apenas fora de produção, quando o login está desabilitado. */
  autenticacao?: { loginDesabilitado: boolean; usuarios: UsuarioDemonstracao[] };
}

export interface ResumoPainel {
  atendente: { nome: string; perfil: Perfil };
  indicadores: {
    emAndamento: number;
    aguardandoAcesso: number;
    aguardandoDocumentos: number;
    aguardandoAnalise: number;
    concluidasHoje: number;
    canceladasHoje: number;
    arquivosRecebidos: number;
    arquivosRecebidosHoje: number;
  };
  recentes: Array<{
    id: string;
    cidadaoNome: string;
    status: StatusSessao;
    tipoAtendimento: string;
    criadoEm: string;
    enviados: number;
    total: number;
  }>;
}

export interface ItemListaSessao {
  id: string;
  codigoCurto: string;
  cidadaoNome: string;
  cpfMascarado: string;
  status: StatusSessao;
  criadoEm: string;
  expiraEm: string;
  encerradoEm: string | null;
  tipoAtendimento: string;
  atendenteNome: string;
  unidadeSigla: string;
  guiche: string | null;
  documentos: { total: number; enviados: number; aprovados: number };
}
