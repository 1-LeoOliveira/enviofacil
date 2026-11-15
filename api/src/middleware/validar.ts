import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';

type Fonte = 'body' | 'query' | 'params';

/**
 * Valida e substitui a fonte pelos dados já convertidos pelo Zod.
 * Usar sempre antes de chegar ao banco: nada entra sem esquema.
 */
export function validar(esquema: ZodTypeAny, fonte: Fonte = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const resultado = esquema.safeParse(req[fonte]);
    if (!resultado.success) {
      next(resultado.error);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any)[fonte] = resultado.data;
    next();
  };
}

export type Inferido<T extends ZodTypeAny> = z.infer<T>;
