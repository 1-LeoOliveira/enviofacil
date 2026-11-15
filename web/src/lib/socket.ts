import { io, type Socket } from 'socket.io-client';

export interface EventoTempoReal {
  sessaoId: string;
  evento: string;
  mensagem?: string;
  dados?: Record<string, unknown>;
  em: string;
}

const URL_SOCKET = (import.meta.env.VITE_SOCKET_URL as string | undefined) ?? undefined;

/**
 * Uma conexão por tipo de usuário. O servidor valida o token no handshake e
 * decide em quais salas o socket pode entrar — o cliente não escolhe.
 */
export function conectar(token: string, tipo: 'servidor' | 'cidadao'): Socket {
  return io(URL_SOCKET ?? '/', {
    path: '/socket.io',
    auth: { token, tipo },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 800,
    reconnectionDelayMax: 5000,
    timeout: 8000,
  });
}
