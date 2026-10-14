import { errorMessage, type Ack, type ClientToServerEvents, type HandshakeAuth, type ServerToClientEvents } from '@sp/shared';
import { io, type Socket } from 'socket.io-client';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const ACK_TIMEOUT_MS = 5000;

/**
 * Stessa origine: in sviluppo Vite fa da proxy a /socket.io, in produzione nginx. Con `recover` il server
 * associa prima questo telefono al giocatore del codice (GAME_DESIGN §14).
 */
export function connectSocket(deviceId: string, recover?: string): GameSocket {
  const auth: HandshakeAuth = recover ? { deviceId, recover } : { deviceId };
  return io({ auth: { ...auth } });
}

/** Dopo il primo state.init il codice non serve più: le riconnessioni automatiche mandano solo il device. */
export function forgetRecover(socket: GameSocket, deviceId: string): void {
  socket.auth = { deviceId } satisfies HandshakeAuth;
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
