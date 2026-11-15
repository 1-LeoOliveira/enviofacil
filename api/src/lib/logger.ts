type Nivel = 'debug' | 'info' | 'warn' | 'error';

const ordem: Record<Nivel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minimo = ordem[(process.env.LOG_LEVEL as Nivel) ?? 'info'] ?? 20;

/** Campos que nunca devem aparecer em log, mesmo por acidente. */
const PROIBIDOS = new Set([
  'cpf',
  'senha',
  'senha_hash',
  'password',
  'token',
  'cidadaoToken',
  'authorization',
  'cpf_cipher',
]);

function limpar(valor: unknown, profundidade = 0): unknown {
  if (profundidade > 4 || valor === null || typeof valor !== 'object') return valor;
  if (Array.isArray(valor)) return valor.slice(0, 20).map((v) => limpar(v, profundidade + 1));
  const saida: Record<string, unknown> = {};
  for (const [chave, v] of Object.entries(valor as Record<string, unknown>)) {
    saida[chave] = PROIBIDOS.has(chave) ? '[omitido]' : limpar(v, profundidade + 1);
  }
  return saida;
}

function escrever(nivel: Nivel, mensagem: string, contexto?: Record<string, unknown>) {
  if (ordem[nivel] < minimo) return;
  const linha = JSON.stringify({
    ts: new Date().toISOString(),
    nivel,
    msg: mensagem,
    ...(contexto ? (limpar(contexto) as Record<string, unknown>) : {}),
  });
  // eslint-disable-next-line no-console
  if (nivel === 'error') console.error(linha);
  else console.log(linha);
}

export const log = {
  debug: (m: string, c?: Record<string, unknown>) => escrever('debug', m, c),
  info: (m: string, c?: Record<string, unknown>) => escrever('info', m, c),
  warn: (m: string, c?: Record<string, unknown>) => escrever('warn', m, c),
  error: (m: string, c?: Record<string, unknown>) => escrever('error', m, c),
};
