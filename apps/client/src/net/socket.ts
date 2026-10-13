import { errorMessage, type Ack, type ClientToServerEvents, type ServerToClientEvents } from '@sp/shared';
import { io, type Socket } from 'socket.io-client';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const ACK_TIMEOUT_MS = 5000;

/** Stessa origine: in sviluppo Vite fa da proxy a /socket.io, in produzione nginx. */
export function connectSocket(deviceId: string): GameSocket {
  return io({ auth: { deviceId } });
}

export class RequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Richiesta con ack: restituisce i dati o lancia RequestError con il messaggio in italiano. */
export async function request<T>(send: () => Promise<Ack<T>>): Promise<T> {
  let res: Ack<T>;
  try {
    res = await send();
  } catch {
    throw new RequestError('BUSY', errorMessage('BUSY'));
  }
  if (!res.ok) throw new RequestError(res.code, res.message);
  return res.data;
}

export { ACK_TIMEOUT_MS };
