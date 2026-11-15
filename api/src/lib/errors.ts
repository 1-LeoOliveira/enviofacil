import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { log } from './logger';

export class AppError extends Error {
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

export const erros = {
  naoAutenticado: (m = 'Sessão não autenticada ou expirada.') =>
    new AppError(401, 'NAO_AUTENTICADO', m),
  semPermissao: (m = 'Você não tem permissão para esta operação.') =>
    new AppError(403, 'SEM_PERMISSAO', m),
  naoEncontrado: (m = 'Registro não encontrado.') => new AppError(404, 'NAO_ENCONTRADO', m),
  invalido: (m: string, detalhes?: unknown) => new AppError(400, 'DADOS_INVALIDOS', m, detalhes),
  conflito: (m: string) => new AppError(409, 'CONFLITO', m),
  muitasTentativas: (m = 'Muitas tentativas. Aguarde alguns instantes.') =>
    new AppError(429, 'MUITAS_TENTATIVAS', m),
  indisponivel: (m: string) => new AppError(503, 'SERVICO_INDISPONIVEL', m),
};

export function naoEncontradoHandler(_req: Request, res: Response) {
  res.status(404).json({ erro: { codigo: 'ROTA_NAO_ENCONTRADA', mensagem: 'Rota não encontrada.' } });
}

export function erroHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      erro: {
        codigo: 'DADOS_INVALIDOS',
        mensagem: 'Dados inválidos na requisição.',
        detalhes: err.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message })),
      },
    });
    return;
  }

  if (err instanceof AppError) {
    if (err.status >= 500) log.error(err.message, { rota: req.path, codigo: err.codigo });
    res.status(err.status).json({
      erro: { codigo: err.codigo, mensagem: err.message, detalhes: err.detalhes },
    });
    return;
  }

  const e = err as { code?: string; message?: string };
  if (e?.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({
      erro: { codigo: 'ARQUIVO_GRANDE', mensagem: 'O arquivo excede o tamanho máximo permitido.' },
    });
    return;
  }
  if (e?.code === 'ER_DUP_ENTRY') {
    res.status(409).json({
      erro: { codigo: 'CONFLITO', mensagem: 'Já existe um registro com estes dados.' },
    });
    return;
  }

  log.error('Erro não tratado', { rota: req.path, mensagem: e?.message, code: e?.code });
  res.status(500).json({
    erro: { codigo: 'ERRO_INTERNO', mensagem: 'Erro interno. Tente novamente em instantes.' },
  });
}

/** Envolve handlers async para que rejeições cheguem ao erroHandler. */
export function assincrono<T extends (req: Request, res: Response, next: NextFunction) => unknown>(
  handler: T,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
