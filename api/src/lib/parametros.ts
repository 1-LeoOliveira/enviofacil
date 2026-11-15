import { consultar, executar, type RowDataPacket } from '../db/pool';

interface LinhaConfig extends RowDataPacket {
  chave: string;
  valor: string;
  tipo: 'INTEIRO' | 'TEXTO' | 'BOOLEANO' | 'LISTA';
  descricao: string | null;
  grupo: string;
  atualizado_em: Date;
}

const PADROES: Record<string, string> = {
  sessao_ttl_minutos: '60',
  sessao_prorrogacao_minutos: '30',
  upload_tamanho_maximo_mb: '10',
  upload_max_arquivos_documento: '3',
  upload_max_arquivos_sessao: '30',
  upload_formatos_permitidos: 'pdf,jpg,jpeg,png',
  retencao_arquivos_dias: '30',
  atendente_pode_adicionar_documento: 'true',
  aviso_ambiente_demonstracao: 'true',
};

let cache: Map<string, string> | null = null;
let cacheExpira = 0;
const CACHE_MS = 15_000;

async function carregar(): Promise<Map<string, string>> {
  if (cache && Date.now() < cacheExpira) return cache;
  const linhas = await consultar<LinhaConfig>('SELECT chave, valor FROM configuracoes');
  const mapa = new Map<string, string>(Object.entries(PADROES));
  for (const linha of linhas) mapa.set(linha.chave, linha.valor);
  cache = mapa;
  cacheExpira = Date.now() + CACHE_MS;
  return mapa;
}

export function invalidarCacheParametros(): void {
  cache = null;
  cacheExpira = 0;
}

export async function parametroTexto(chave: string): Promise<string> {
  const mapa = await carregar();
  return mapa.get(chave) ?? PADROES[chave] ?? '';
}

export async function parametroInteiro(chave: string): Promise<number> {
  const bruto = await parametroTexto(chave);
  const n = Number.parseInt(bruto, 10);
  return Number.isFinite(n) ? n : Number.parseInt(PADROES[chave] ?? '0', 10);
}

export async function parametroBooleano(chave: string): Promise<boolean> {
  const bruto = (await parametroTexto(chave)).toLowerCase();
  return ['1', 'true', 'sim'].includes(bruto);
}

export async function parametroLista(chave: string): Promise<string[]> {
  const bruto = await parametroTexto(chave);
  return bruto
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

export interface ParametrosUpload {
  tamanhoMaximoBytes: number;
  maxArquivosPorDocumento: number;
  maxArquivosPorSessao: number;
  formatos: string[];
}

export async function parametrosUpload(): Promise<ParametrosUpload> {
  const [mb, porDocumento, porSessao, formatos] = await Promise.all([
    parametroInteiro('upload_tamanho_maximo_mb'),
    parametroInteiro('upload_max_arquivos_documento'),
    parametroInteiro('upload_max_arquivos_sessao'),
    parametroLista('upload_formatos_permitidos'),
  ]);
  return {
    tamanhoMaximoBytes: Math.max(1, mb) * 1024 * 1024,
    maxArquivosPorDocumento: Math.max(1, porDocumento),
    maxArquivosPorSessao: Math.max(1, porSessao),
    formatos: formatos.length ? formatos : ['pdf', 'jpg', 'jpeg', 'png'],
  };
}

export async function listarParametros(): Promise<LinhaConfig[]> {
  return consultar<LinhaConfig>(
    'SELECT chave, valor, tipo, descricao, grupo, atualizado_em FROM configuracoes ORDER BY grupo, chave',
  );
}

export async function atualizarParametro(
  chave: string,
  valor: string,
  usuarioId: number,
): Promise<void> {
  await executar(
    'UPDATE configuracoes SET valor = ?, atualizado_por = ? WHERE chave = ?',
    [valor, usuarioId, chave],
  );
  invalidarCacheParametros();
}
