import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env';
import { cifrarArquivo, decifrarArquivo, uuid } from '../lib/crypto';
import { log } from '../lib/logger';

export interface ArquivoGravado {
  chave: string;
  iv: Buffer;
  tag: Buffer;
  tamanho: number;
}

/**
 * Contrato de armazenamento. A implementação local grava o arquivo cifrado em
 * volume privado; para produção basta implementar a mesma interface sobre
 * S3/MinIO sem tocar nos módulos de negócio.
 */
export interface ArmazenamentoArquivos {
  gravar(sessaoId: string, dados: Buffer, extensao: string): Promise<ArquivoGravado>;
  ler(chave: string, iv: Buffer, tag: Buffer): Promise<Buffer>;
  remover(chave: string): Promise<void>;
}

class ArmazenamentoLocalCifrado implements ArmazenamentoArquivos {
  private readonly raiz: string;

  constructor(raiz: string) {
    this.raiz = raiz;
  }

  private caminho(chave: string): string {
    // A chave é gerada internamente; ainda assim normalizamos para impedir
    // qualquer tentativa de escapar do diretório raiz.
    const normalizada = path.normalize(chave).replace(/^(\.\.(\/|\\|$))+/, '');
    const destino = path.join(this.raiz, normalizada);
    if (!destino.startsWith(this.raiz)) {
      throw new Error('Caminho de arquivo inválido.');
    }
    return destino;
  }

  async gravar(sessaoId: string, dados: Buffer, extensao: string): Promise<ArquivoGravado> {
    const seguro = extensao.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
    const chave = path.posix.join(sessaoId, `${uuid()}.${seguro}.enc`);
    const destino = this.caminho(chave);
    await fs.mkdir(path.dirname(destino), { recursive: true });
    const { conteudo, iv, tag } = cifrarArquivo(dados);
    await fs.writeFile(destino, conteudo, { mode: 0o600 });
    return { chave, iv, tag, tamanho: dados.length };
  }

  async ler(chave: string, iv: Buffer, tag: Buffer): Promise<Buffer> {
    const conteudo = await fs.readFile(this.caminho(chave));
    return decifrarArquivo(conteudo, iv, tag);
  }

  async remover(chave: string): Promise<void> {
    try {
      await fs.unlink(this.caminho(chave));
    } catch (erro) {
      const e = erro as NodeJS.ErrnoException;
      if (e.code !== 'ENOENT') throw erro;
    }
  }
}

export const armazenamento: ArmazenamentoArquivos = new ArmazenamentoLocalCifrado(env.storageDir);

export async function prepararArmazenamento(): Promise<void> {
  await fs.mkdir(env.storageDir, { recursive: true });
  log.info('Armazenamento de documentos pronto', { diretorio: env.storageDir, cifra: 'AES-256-GCM' });
}
