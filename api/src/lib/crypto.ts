import crypto from 'node:crypto';
import { env } from '../config/env';

const ALGORITMO = 'aes-256-gcm';

function derivar(proposito: string, segredo: string): Buffer {
  // HKDF-like: uma chave distinta por propósito a partir do segredo configurado.
  return crypto.createHash('sha256').update(`${proposito}:${segredo}`).digest();
}

const CHAVE_DADOS = derivar('dados', env.chaveDados);
const CHAVE_ARQUIVOS = derivar('arquivos', env.chaveDados);

// ---------------------------------------------------------------- textos (CPF)

/** Cifra um texto curto e devolve iv(12) + tag(16) + conteúdo em um só buffer. */
export function cifrarTexto(texto: string): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITMO, CHAVE_DADOS, iv);
  const conteudo = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), conteudo]);
}

export function decifrarTexto(pacote: Buffer): string {
  const iv = pacote.subarray(0, 12);
  const tag = pacote.subarray(12, 28);
  const conteudo = pacote.subarray(28);
  const decipher = crypto.createDecipheriv(ALGORITMO, CHAVE_DADOS, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(conteudo), decipher.final()]).toString('utf8');
}

// -------------------------------------------------------------------- arquivos

export interface ArquivoCifrado {
  conteudo: Buffer;
  iv: Buffer;
  tag: Buffer;
}

export function cifrarArquivo(dados: Buffer): ArquivoCifrado {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITMO, CHAVE_ARQUIVOS, iv);
  const conteudo = Buffer.concat([cipher.update(dados), cipher.final()]);
  return { conteudo, iv, tag: cipher.getAuthTag() };
}

export function decifrarArquivo(conteudo: Buffer, iv: Buffer, tag: Buffer): Buffer {
  const decipher = crypto.createDecipheriv(ALGORITMO, CHAVE_ARQUIVOS, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(conteudo), decipher.final()]);
}

// ------------------------------------------------------------------ hashes/CPF

export function hmacCpf(cpf: string): string {
  return crypto.createHmac('sha256', env.chaveCpf).update(somenteDigitos(cpf)).digest('hex');
}

export function sha256(dados: Buffer | string): string {
  return crypto.createHash('sha256').update(dados).digest('hex');
}

export function somenteDigitos(valor: string): string {
  return (valor ?? '').replace(/\D+/g, '');
}

export function formatarCpf(cpf: string): string {
  const d = somenteDigitos(cpf).padStart(11, '0');
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** Mantém apenas os dígitos do meio, suficiente para conferência no guichê. */
export function mascararCpf(cpf: string): string {
  const d = somenteDigitos(cpf).padStart(11, '0');
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
}

export function cpfValido(valor: string): boolean {
  const cpf = somenteDigitos(valor);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  for (const tamanho of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < tamanho; i += 1) {
      soma += Number(cpf[i]) * (tamanho + 1 - i);
    }
    const resto = (soma * 10) % 11;
    const digito = resto === 10 ? 0 : resto;
    if (digito !== Number(cpf[tamanho])) return false;
  }
  return true;
}

// -------------------------------------------------------------------- sessões

/** Token de 256 bits, imprevisível, usado apenas na URL do portal. */
export function gerarTokenSessao(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const ALFABETO_CODIGO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem I, O, 0, 1

/** Código curto de 8 caracteres, legível em voz alta e sem ambiguidade. */
export function gerarCodigoCurto(): string {
  const bytes = crypto.randomBytes(8);
  let codigo = '';
  for (let i = 0; i < 8; i += 1) {
    codigo += ALFABETO_CODIGO[bytes[i] % ALFABETO_CODIGO.length];
  }
  return `${codigo.slice(0, 4)}-${codigo.slice(4)}`;
}

export function normalizarCodigoCurto(codigo: string): string {
  const limpo = (codigo ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return limpo.length === 8 ? `${limpo.slice(0, 4)}-${limpo.slice(4)}` : limpo;
}

// ------------------------------------------------------- links de download

/**
 * Link temporário assinado: permite exibir imagem/PDF em <img>/<iframe>,
 * onde não é possível enviar cabeçalho Authorization.
 */
export function assinarLinkArquivo(arquivoId: string, escopo: string, ttlSegundos: number): string {
  const expira = Math.floor(Date.now() / 1000) + ttlSegundos;
  const base = `${arquivoId}.${escopo}.${expira}`;
  const assinatura = crypto
    .createHmac('sha256', env.chaveLinks)
    .update(base)
    .digest('base64url');
  return `${expira}.${escopo}.${assinatura}`;
}

export function verificarLinkArquivo(
  arquivoId: string,
  assinatura: string,
): { valido: boolean; escopo?: string } {
  const partes = (assinatura ?? '').split('.');
  if (partes.length !== 3) return { valido: false };
  const [expiraTexto, escopo, sig] = partes;
  const expira = Number.parseInt(expiraTexto, 10);
  if (!Number.isFinite(expira) || expira < Math.floor(Date.now() / 1000)) return { valido: false };
  const esperado = crypto
    .createHmac('sha256', env.chaveLinks)
    .update(`${arquivoId}.${escopo}.${expira}`)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { valido: false };
  return { valido: true, escopo };
}

export function uuid(): string {
  return crypto.randomUUID();
}
