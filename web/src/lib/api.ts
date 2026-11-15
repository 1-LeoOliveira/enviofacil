export const BASE_API = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

const CHAVE_TOKEN_SERVIDOR = 'envio-facil.token';
const CHAVE_TOKEN_CIDADAO = 'envio-facil.cidadao';

export class ErroApi extends Error {
  status: number;
  codigo: string;
  detalhes?: unknown;

  constructor(status: number, codigo: string, mensagem: string, detalhes?: unknown) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

/** Token do servidor persiste entre abas; o do cidadão vive só na aba atual. */
export const tokenServidor = {
  ler: () => localStorage.getItem(CHAVE_TOKEN_SERVIDOR),
  gravar: (token: string) => localStorage.setItem(CHAVE_TOKEN_SERVIDOR, token),
  limpar: () => localStorage.removeItem(CHAVE_TOKEN_SERVIDOR),
};

export const tokenCidadao = {
  ler: () => sessionStorage.getItem(CHAVE_TOKEN_CIDADAO),
  gravar: (token: string) => sessionStorage.setItem(CHAVE_TOKEN_CIDADAO, token),
  limpar: () => sessionStorage.removeItem(CHAVE_TOKEN_CIDADAO),
};

type Escopo = 'servidor' | 'cidadao' | 'publico';

interface Opcoes {
  metodo?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  corpo?: unknown;
  formulario?: FormData;
  escopo?: Escopo;
  sinal?: AbortSignal;
}

function tokenDoEscopo(escopo: Escopo): string | null {
  if (escopo === 'servidor') return tokenServidor.ler();
  if (escopo === 'cidadao') return tokenCidadao.ler();
  return null;
}

export async function requisitar<T>(caminho: string, opcoes: Opcoes = {}): Promise<T> {
  const { metodo = 'GET', corpo, formulario, escopo = 'servidor', sinal } = opcoes;

  const cabecalhos: Record<string, string> = {};
  const token = tokenDoEscopo(escopo);
  if (token) cabecalhos.Authorization = `Bearer ${token}`;
  if (corpo !== undefined) cabecalhos['Content-Type'] = 'application/json';

  let resposta: Response;
  try {
    resposta = await fetch(`${BASE_API}${caminho}`, {
      method: metodo,
      headers: cabecalhos,
      body: formulario ?? (corpo !== undefined ? JSON.stringify(corpo) : undefined),
      signal: sinal,
    });
  } catch (erro) {
    if ((erro as Error).name === 'AbortError') throw erro;
    throw new ErroApi(
      0,
      'SEM_CONEXAO',
      'Não foi possível falar com o servidor. Verifique a conexão e tente novamente.',
    );
  }

  if (resposta.status === 204) return undefined as T;

  const texto = await resposta.text();
  const dados = texto ? (JSON.parse(texto) as unknown) : null;

  if (!resposta.ok) {
    const erro = (dados as { erro?: { codigo: string; mensagem: string; detalhes?: unknown } })?.erro;
    // Token do servidor expirado: limpamos para forçar novo login.
    if (resposta.status === 401 && escopo === 'servidor') tokenServidor.limpar();
    throw new ErroApi(
      resposta.status,
      erro?.codigo ?? 'ERRO',
      erro?.mensagem ?? 'Não foi possível concluir a operação.',
      erro?.detalhes,
    );
  }

  return dados as T;
}

export const api = {
  get: <T>(caminho: string, escopo: Escopo = 'servidor') => requisitar<T>(caminho, { escopo }),
  post: <T>(caminho: string, corpo?: unknown, escopo: Escopo = 'servidor') =>
    requisitar<T>(caminho, { metodo: 'POST', corpo, escopo }),
  put: <T>(caminho: string, corpo?: unknown, escopo: Escopo = 'servidor') =>
    requisitar<T>(caminho, { metodo: 'PUT', corpo, escopo }),
  delete: <T>(caminho: string, escopo: Escopo = 'servidor') =>
    requisitar<T>(caminho, { metodo: 'DELETE', escopo }),
  enviarArquivo: <T>(caminho: string, formulario: FormData, escopo: Escopo = 'servidor') =>
    requisitar<T>(caminho, { metodo: 'POST', formulario, escopo }),
};

export interface LinkArquivo {
  url: string;
  expiraEm: string;
  nomeOriginal: string;
  mime: string;
  tamanhoBytes: number;
}

/** Pede um link assinado e devolve a URL completa, pronta para <img>/<iframe>/download. */
export async function obterLinkArquivo(
  arquivoId: string,
  escopo: Escopo = 'servidor',
): Promise<LinkArquivo & { urlCompleta: string }> {
  const link = await api.post<LinkArquivo>(`/arquivos/${arquivoId}/link`, undefined, escopo);
  return { ...link, urlCompleta: `${BASE_API}${link.url}` };
}

export async function baixarArquivo(arquivoId: string, escopo: Escopo = 'servidor'): Promise<void> {
  const link = await obterLinkArquivo(arquivoId, escopo);
  const ancora = document.createElement('a');
  ancora.href = `${link.urlCompleta}&modo=download`;
  ancora.download = link.nomeOriginal;
  document.body.appendChild(ancora);
  ancora.click();
  ancora.remove();
}
