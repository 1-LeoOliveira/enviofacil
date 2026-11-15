import multer from 'multer';
import path from 'node:path';
import { erros } from '../lib/errors';
import { parametrosUpload } from '../lib/parametros';

/** Limite absoluto do multer; o limite configurável é checado depois, no handler. */
const LIMITE_ABSOLUTO_BYTES = 25 * 1024 * 1024;

export const receberArquivo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITE_ABSOLUTO_BYTES, files: 1, fields: 10 },
}).single('arquivo');

interface Assinatura {
  mime: string;
  extensoes: string[];
  confere: (b: Buffer) => boolean;
}

/**
 * Validação por conteúdo real (magic bytes). Extensão e Content-Type vêm do
 * cliente e não podem ser a única verificação.
 */
const ASSINATURAS: Assinatura[] = [
  {
    mime: 'application/pdf',
    extensoes: ['pdf'],
    confere: (b) => b.length > 4 && b.subarray(0, 5).toString('latin1') === '%PDF-',
  },
  {
    mime: 'image/jpeg',
    extensoes: ['jpg', 'jpeg'],
    confere: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/png',
    extensoes: ['png'],
    confere: (b) =>
      b.length > 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
];

/** Conteúdo que não deve existir dentro de um PDF aceito no guichê. */
const PADROES_PERIGOSOS_PDF = [/\/JavaScript/i, /\/JS\s/i, /\/Launch/i, /\/EmbeddedFile/i];

export interface ArquivoValidado {
  mime: string;
  extensao: string;
  nomeOriginal: string;
  tamanho: number;
  alertas: string[];
}

export async function validarArquivo(
  arquivo: Express.Multer.File | undefined,
): Promise<ArquivoValidado> {
  if (!arquivo || !arquivo.buffer?.length) {
    throw erros.invalido('Nenhum arquivo foi recebido.');
  }

  const limites = await parametrosUpload();
  if (arquivo.size > limites.tamanhoMaximoBytes) {
    const mb = Math.round(limites.tamanhoMaximoBytes / (1024 * 1024));
    throw erros.invalido(`O arquivo excede o limite de ${mb} MB.`);
  }

  const extensaoInformada = path.extname(arquivo.originalname).replace('.', '').toLowerCase();
  if (!limites.formatos.includes(extensaoInformada)) {
    throw erros.invalido(
      `Formato não permitido. Envie um arquivo ${limites.formatos.join(', ').toUpperCase()}.`,
    );
  }

  const assinatura = ASSINATURAS.find((a) => a.confere(arquivo.buffer));
  if (!assinatura) {
    throw erros.invalido(
      'O conteúdo do arquivo não corresponde a um PDF ou imagem válidos. Tente enviar novamente.',
    );
  }
  if (!assinatura.extensoes.includes(extensaoInformada)) {
    throw erros.invalido('A extensão do arquivo não corresponde ao seu conteúdo real.');
  }

  const alertas: string[] = [];
  if (assinatura.mime === 'application/pdf') {
    const amostra = arquivo.buffer.subarray(0, Math.min(arquivo.buffer.length, 512 * 1024)).toString('latin1');
    if (PADROES_PERIGOSOS_PDF.some((p) => p.test(amostra))) {
      throw erros.invalido(
        'O PDF contém recursos ativos (script ou anexo) e não pode ser aceito. Gere um PDF simples ou envie uma foto do documento.',
      );
    }
  }

  const nomeOriginal = path
    .basename(arquivo.originalname)
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_')
    .slice(0, 180);

  return {
    mime: assinatura.mime,
    extensao: extensaoInformada,
    nomeOriginal,
    tamanho: arquivo.size,
    alertas,
  };
}
