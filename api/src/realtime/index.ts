import type { Server as HttpServer } from 'node:http';
import { Server as ServidorSocket, type Socket } from 'socket.io';
import { env } from '../config/env';
import { log } from '../lib/logger';
import { lerTokenCidadao, lerTokenServidor, type UsuarioAutenticado } from '../middleware/auth';
import { consultarUm, type RowDataPacket } from '../db/pool';

export type EventoSessao =
  | 'sessao:acessada'
  | 'sessao:atualizada'
  | 'sessao:encerrada'
  | 'documento:anexado'
  | 'documento:enviado'
  | 'documento:aprovado'
  | 'documento:rejeitado'
  | 'documento:novo-envio'
  | 'documento:orientacao'
  | 'documento:adicionado'
  | 'documento:removido'
  | 'arquivo:disponibilizado'
  | 'arquivo:removido'
  | 'envio:concluido';

let io: ServidorSocket | null = null;

const SALA_SESSAO = (sessaoId: string) => `sessao:${sessaoId}`;
const SALA_ATENDENTE = (usuarioId: number) => `atendente:${usuarioId}`;
const SALA_UNIDADE = (unidadeId: number) => `unidade:${unidadeId}`;

interface LinhaSessaoEscopo extends RowDataPacket {
  id: string;
  atendente_id: number;
  unidade_id: number;
}

async function podeAcompanhar(usuario: UsuarioAutenticado, sessaoId: string): Promise<boolean> {
  const sessao = await consultarUm<LinhaSessaoEscopo>(
    'SELECT id, atendente_id, unidade_id FROM sessoes WHERE id = ?',
    [sessaoId],
  );
  if (!sessao) return false;
  if (usuario.perfil === 'ADMIN') return true;
  if (usuario.perfil === 'SUPERVISOR') return sessao.unidade_id === usuario.unidadeId;
  return sessao.atendente_id === usuario.id;
}

export function iniciarTempoReal(servidor: HttpServer): ServidorSocket {
  io = new ServidorSocket(servidor, {
    path: '/socket.io',
    cors: { origin: env.corsOrigens, credentials: true },
    pingInterval: 20_000,
    pingTimeout: 25_000,
    maxHttpBufferSize: 1e6,
  });

  io.use((socket, next) => {
    const { token, tipo } = (socket.handshake.auth ?? {}) as { token?: string; tipo?: string };
    if (!token) {
      next(new Error('Token ausente.'));
      return;
    }

    if (tipo === 'cidadao') {
      const cidadao = lerTokenCidadao(token);
      if (!cidadao) {
        next(new Error('Token inválido.'));
        return;
      }
      socket.data.tipo = 'cidadao';
      socket.data.sessaoId = cidadao.sessaoId;
      next();
      return;
    }

    const usuario = lerTokenServidor(token);
    if (!usuario) {
      next(new Error('Token inválido.'));
      return;
    }
    socket.data.tipo = 'servidor';
    socket.data.usuario = usuario;
    next();
  });

  io.on('connection', (socket: Socket) => {
    if (socket.data.tipo === 'cidadao') {
      // O cidadão só entra na sala da própria sessão, vinda do token.
      socket.join(SALA_SESSAO(socket.data.sessaoId as string));
      log.debug('Cidadão conectado ao tempo real', { sessao: socket.data.sessaoId });
    } else {
      const usuario = socket.data.usuario as UsuarioAutenticado;
      socket.join(SALA_ATENDENTE(usuario.id));
      if (usuario.unidadeId) socket.join(SALA_UNIDADE(usuario.unidadeId));

      socket.on('acompanhar-sessao', async (sessaoId: unknown) => {
        if (typeof sessaoId !== 'string') return;
        if (await podeAcompanhar(usuario, sessaoId)) {
          socket.join(SALA_SESSAO(sessaoId));
          socket.emit('acompanhando', { sessaoId });
        } else {
          socket.emit('erro', { mensagem: 'Sem permissão para acompanhar esta sessão.' });
        }
      });

      socket.on('parar-acompanhamento', (sessaoId: unknown) => {
        if (typeof sessaoId === 'string') socket.leave(SALA_SESSAO(sessaoId));
      });
    }
  });

  log.info('Serviço de tempo real iniciado', { caminho: '/socket.io' });
  return io;
}

export interface PayloadEvento {
  sessaoId: string;
  evento: EventoSessao;
  mensagem?: string;
  dados?: Record<string, unknown>;
}

/** Notifica todos os participantes de uma sessão (cidadão e servidores). */
export function emitirSessao(payload: PayloadEvento): void {
  if (!io) return;
  io.to(SALA_SESSAO(payload.sessaoId)).emit('sessao:evento', {
    ...payload,
    em: new Date().toISOString(),
  });
}

/** Notifica o atendente responsável mesmo que ele não esteja na tela da sessão. */
export function emitirAtendente(usuarioId: number, payload: PayloadEvento): void {
  if (!io) return;
  io.to(SALA_ATENDENTE(usuarioId)).emit('painel:evento', {
    ...payload,
    em: new Date().toISOString(),
  });
}

export function emitirUnidade(unidadeId: number, payload: PayloadEvento): void {
  if (!io) return;
  io.to(SALA_UNIDADE(unidadeId)).emit('painel:evento', {
    ...payload,
    em: new Date().toISOString(),
  });
}

/**
 * Encerra as conexões do cidadão em uma sessão revogada ou expirada.
 * Os servidores conectados continuam, pois acompanham outras sessões.
 */
export async function desconectarCidadaos(sessaoId: string): Promise<void> {
  if (!io) return;
  const sockets = await io.in(SALA_SESSAO(sessaoId)).fetchSockets();
  for (const socket of sockets) {
    if (socket.data.tipo === 'cidadao') socket.disconnect(true);
  }
}

export async function encerrarTempoReal(): Promise<void> {
  if (io) {
    await io.close();
    io = null;
  }
}
