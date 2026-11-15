import rateLimit, { type Options } from 'express-rate-limit';
import type { Request } from 'express';
import { log } from '../lib/logger';

function construir(nome: string, windowMs: number, limit: number, chave?: (req: Request) => string) {
  const opcoes: Partial<Options> = {
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: chave,
    handler: (req, res) => {
      log.warn('Limite de requisições atingido', { limitador: nome, rota: req.path });
      res.status(429).json({
        erro: {
          codigo: 'MUITAS_TENTATIVAS',
          mensagem: 'Muitas tentativas em pouco tempo. Aguarde alguns instantes e tente de novo.',
        },
      });
    },
  };
  return rateLimit(opcoes);
}

/** Protege contra força bruta de senha, por IP. */
export const limiteLogin = construir('login', 15 * 60 * 1000, 12);

/** Protege a descoberta de sessões por código curto ou token. */
export const limiteAcessoPortal = construir('acesso-portal', 10 * 60 * 1000, 25);

/** Evita abuso de upload por um mesmo dispositivo. */
export const limiteUpload = construir('upload', 10 * 60 * 1000, 120);

/** Teto geral da API. */
export const limiteGeral = construir('geral', 60 * 1000, 600);

/** Links assinados de download. */
export const limiteDownload = construir('download', 60 * 1000, 240);
