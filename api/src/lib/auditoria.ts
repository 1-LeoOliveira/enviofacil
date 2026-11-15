import type { Request } from 'express';
import { executar } from '../db/pool';
import { log } from './logger';

export interface RegistroAuditoria {
  usuarioId?: number | null;
  ator?: 'ADMIN' | 'SUPERVISOR' | 'ATENDENTE' | 'CIDADAO' | 'SISTEMA';
  acao: string;
  entidade: string;
  entidadeId?: string | number | null;
  resultado?: 'SUCESSO' | 'FALHA';
  detalhes?: Record<string, unknown>;
}

function ipDaRequisicao(req: Request): string {
  const encaminhado = req.headers['x-forwarded-for'];
  if (typeof encaminhado === 'string' && encaminhado.length) return encaminhado.split(',')[0].trim();
  return req.ip ?? req.socket.remoteAddress ?? 'desconhecido';
}

/**
 * Trilha de auditoria. Nunca grava CPF, token ou conteúdo de arquivo:
 * apenas identificadores e metadados da operação.
 */
export async function auditar(req: Request | null, registro: RegistroAuditoria): Promise<void> {
  try {
    await executar(
      `INSERT INTO auditoria (usuario_id, ator, acao, entidade, entidade_id, resultado, ip, user_agent, detalhes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        registro.usuarioId ?? null,
        registro.ator ?? 'SISTEMA',
        registro.acao,
        registro.entidade,
        registro.entidadeId != null ? String(registro.entidadeId) : null,
        registro.resultado ?? 'SUCESSO',
        req ? ipDaRequisicao(req).slice(0, 60) : null,
        req ? String(req.headers['user-agent'] ?? '').slice(0, 255) : null,
        registro.detalhes ? JSON.stringify(registro.detalhes) : null,
      ],
    );
  } catch (erro) {
    // Auditoria não deve derrubar a operação principal, mas precisa aparecer no log.
    log.error('Falha ao registrar auditoria', {
      acao: registro.acao,
      mensagem: (erro as Error).message,
    });
  }
}

export { ipDaRequisicao };
