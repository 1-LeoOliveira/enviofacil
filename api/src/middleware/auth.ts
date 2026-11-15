import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { erros } from '../lib/errors';
import { consultarUm, type RowDataPacket } from '../db/pool';

export type Perfil = 'ADMIN' | 'SUPERVISOR' | 'ATENDENTE';

export interface UsuarioAutenticado {
  id: number;
  nome: string;
  email: string;
  perfil: Perfil;
  unidadeId: number | null;
  guicheId: number | null;
}

export interface CidadaoAutenticado {
  sessaoId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      usuario?: UsuarioAutenticado;
      cidadao?: CidadaoAutenticado;
    }
  }
}

interface PayloadServidor {
  typ: 'servidor';
  sub: string;
  perfil: Perfil;
  uni: number | null;
  gui: number | null;
  nome: string;
  email: string;
}

interface PayloadCidadao {
  typ: 'cidadao';
  /** Id da sessão digital. Nenhum dado pessoal vai no token. */
  sid: string;
}

export function assinarTokenServidor(usuario: UsuarioAutenticado): string {
  const payload: PayloadServidor = {
    typ: 'servidor',
    sub: String(usuario.id),
    perfil: usuario.perfil,
    uni: usuario.unidadeId,
    gui: usuario.guicheId,
    nome: usuario.nome,
    email: usuario.email,
  };
  return jwt.sign(payload, env.jwtSegredo, { expiresIn: env.jwtExpiracaoServidor });
}

/** O token do cidadão expira junto com a sessão digital. */
export function assinarTokenCidadao(sessaoId: string, expiraEm: Date): string {
  const segundos = Math.max(60, Math.floor((expiraEm.getTime() - Date.now()) / 1000));
  const payload: PayloadCidadao = { typ: 'cidadao', sid: sessaoId };
  return jwt.sign(payload, env.jwtSegredo, { expiresIn: segundos });
}

function extrairToken(req: Request): string | null {
  const cabecalho = req.headers.authorization;
  if (cabecalho?.startsWith('Bearer ')) return cabecalho.slice(7).trim();
  return null;
}

function verificar<T>(token: string): T {
  try {
    return jwt.verify(token, env.jwtSegredo) as T;
  } catch {
    throw erros.naoAutenticado();
  }
}

interface LinhaUsuario extends RowDataPacket {
  id: number;
  nome: string;
  email: string;
  perfil: Perfil;
  unidade_id: number | null;
  guiche_id: number | null;
  ativo: number;
}

/** Exige servidor autenticado e confere, a cada requisição, se segue ativo. */
export async function exigirServidor(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extrairToken(req);
    if (!token) throw erros.naoAutenticado();
    const payload = verificar<PayloadServidor>(token);
    if (payload.typ !== 'servidor') throw erros.naoAutenticado();

    const usuario = await consultarUm<LinhaUsuario>(
      'SELECT id, nome, email, perfil, unidade_id, guiche_id, ativo FROM usuarios WHERE id = ?',
      [Number(payload.sub)],
    );
    if (!usuario || !usuario.ativo) {
      throw erros.naoAutenticado('Usuário inativo ou inexistente.');
    }

    req.usuario = {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      perfil: usuario.perfil,
      unidadeId: usuario.unidade_id,
      guicheId: usuario.guiche_id,
    };
    next();
  } catch (erro) {
    next(erro);
  }
}

export function exigirPerfil(...perfis: Perfil[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.usuario) {
      next(erros.naoAutenticado());
      return;
    }
    if (!perfis.includes(req.usuario.perfil)) {
      next(erros.semPermissao());
      return;
    }
    next();
  };
}

/** Exige o token emitido ao cidadão no acesso à sessão (escopo de uma sessão). */
export function exigirCidadao(req: Request, _res: Response, next: NextFunction): void {
  try {
    const token = extrairToken(req);
    if (!token) throw erros.naoAutenticado('Acesse novamente pelo QR Code ou pelo código.');
    const payload = verificar<PayloadCidadao>(token);
    if (payload.typ !== 'cidadao' || !payload.sid) throw erros.naoAutenticado();
    req.cidadao = { sessaoId: payload.sid };
    next();
  } catch (erro) {
    next(erro);
  }
}

/** Verifica o token de sessão do cidadão vindo do handshake do Socket.IO. */
export function lerTokenCidadao(token: string): CidadaoAutenticado | null {
  try {
    const payload = jwt.verify(token, env.jwtSegredo) as PayloadCidadao;
    if (payload.typ !== 'cidadao' || !payload.sid) return null;
    return { sessaoId: payload.sid };
  } catch {
    return null;
  }
}

export function lerTokenServidor(token: string): UsuarioAutenticado | null {
  try {
    const payload = jwt.verify(token, env.jwtSegredo) as PayloadServidor;
    if (payload.typ !== 'servidor') return null;
    return {
      id: Number(payload.sub),
      nome: payload.nome,
      email: payload.email,
      perfil: payload.perfil,
      unidadeId: payload.uni,
      guicheId: payload.gui,
    };
  } catch {
    return null;
  }
}
