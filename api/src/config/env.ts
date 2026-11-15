import crypto from 'node:crypto';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const producao = process.env.NODE_ENV === 'production';

/**
 * Em produção toda chave é obrigatória. Em desenvolvimento, para não travar o
 * primeiro `npm run dev`, geramos um valor efêmero e avisamos no log — isso
 * invalida tokens e arquivos cifrados a cada reinício, de propósito.
 */
function chaveObrigatoria(nome: string, bytes = 32): string {
  const valor = process.env[nome];
  if (valor && valor.length >= 32) return valor;
  if (producao) {
    throw new Error(
      `Variável de ambiente ${nome} é obrigatória em produção (mínimo 32 caracteres).`,
    );
  }
  const gerada = crypto.randomBytes(bytes).toString('hex');
  // eslint-disable-next-line no-console
  console.warn(
    `[envio-facil] ATENÇÃO: ${nome} não definida. Usando chave efêmera de desenvolvimento.`,
  );
  return gerada;
}

function inteiro(nome: string, padrao: number): number {
  const bruto = process.env[nome];
  if (!bruto) return padrao;
  const n = Number.parseInt(bruto, 10);
  return Number.isFinite(n) ? n : padrao;
}

function booleano(nome: string, padrao: boolean): boolean {
  const bruto = process.env[nome];
  if (bruto === undefined) return padrao;
  return ['1', 'true', 'sim', 'yes'].includes(bruto.toLowerCase());
}

export const env = {
  ambiente: process.env.NODE_ENV ?? 'development',
  producao,
  porta: inteiro('PORT', 4000),

  /** URL pública pela qual o celular do cidadão alcança a aplicação. */
  urlPublica: (process.env.APP_PUBLIC_URL ?? 'http://localhost:8080').replace(/\/+$/, ''),

  corsOrigens: (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:8080')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  db: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    porta: inteiro('DB_PORT', 3306),
    usuario: process.env.DB_USER ?? 'envio_facil',
    senha: process.env.DB_PASSWORD ?? 'envio_facil',
    banco: process.env.DB_NAME ?? 'envio_facil',
    poolLimite: inteiro('DB_POOL_LIMIT', 12),
  },

  jwtSegredo: chaveObrigatoria('JWT_SECRET'),
  jwtExpiracaoServidor: process.env.JWT_EXPIRES_IN ?? '8h',

  /** AES-256-GCM para CPF e para o conteúdo dos arquivos. */
  chaveDados: chaveObrigatoria('DATA_ENCRYPTION_KEY'),
  /** HMAC determinístico do CPF (busca sem armazenar o número em claro). */
  chaveCpf: chaveObrigatoria('CPF_HASH_KEY'),
  /** Assinatura dos links temporários de download. */
  chaveLinks: chaveObrigatoria('FILE_SIGNING_KEY'),
  linkDownloadSegundos: inteiro('DOWNLOAD_LINK_TTL_SECONDS', 120),

  storageDir: path.resolve(process.env.STORAGE_DIR ?? path.join(process.cwd(), 'storage')),

  cidadaos: {
    provedor: (process.env.CIDADAO_PROVIDER ?? 'demo') as 'demo' | 'http',
    apiUrl: process.env.CIDADAO_API_URL ?? '',
    apiToken: process.env.CIDADAO_API_TOKEN ?? '',
    timeoutMs: inteiro('CIDADAO_API_TIMEOUT_MS', 6000),
  },

  semearDemo: booleano('SEED_DEMO', !producao),
  executarMigracoes: booleano('RUN_MIGRATIONS', true),
  confiarProxy: booleano('TRUST_PROXY', true),
  /**
   * Modo de demonstração sem tela de login: a interface entra direto como um
   * usuário de demonstração. Nunca é ativado em produção, mesmo que a variável
   * esteja definida — a autenticação real continua no código, apenas não é exigida.
   */
  loginDesabilitado: !producao && booleano('LOGIN_DESABILITADO', false),

  /** Fuso usado para o dia civil dos indicadores. */
  fusoHorario: process.env.APP_TIMEZONE ?? 'America/Sao_Paulo',
} as const;

export type Env = typeof env;
