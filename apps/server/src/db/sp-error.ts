/**
 * Errore applicativo di una stored procedure (`SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'UPPER_SNAKE'`).
 * Il `code` corrisponde 1:1 a un codice errore del gateway e a un messaggio UI in italiano.
 */
export class SpError extends Error {
  constructor(
    readonly code: string,
    readonly detail?: string,
  ) {
    super(detail ? `${code}:${detail}` : code);
    this.name = 'SpError';
  }
}

/** Deadlock riprovato senza successo, o attesa di lock scaduta: il gateway risponde "il mercato è affollato". */
export const BUSY = 'BUSY';

interface MysqlError {
  errno?: number;
  sqlState?: string;
  sqlMessage?: string;
}

export const ER_LOCK_WAIT_TIMEOUT = 1205;
export const ER_LOCK_DEADLOCK = 1213;

export function isDeadlock(err: unknown): boolean {
  return (err as MysqlError)?.errno === ER_LOCK_DEADLOCK;
}

/** Converte gli errori MySQL noti in SpError; gli altri passano invariati (sono bug, non casi di gioco). */
export function toSpError(err: unknown): unknown {
  const e = err as MysqlError;
  if (e?.sqlState === '45000' && e.sqlMessage) {
    const sep = e.sqlMessage.indexOf(':');
    return sep === -1 ? new SpError(e.sqlMessage) : new SpError(e.sqlMessage.slice(0, sep), e.sqlMessage.slice(sep + 1));
  }
  if (e?.errno === ER_LOCK_DEADLOCK || e?.errno === ER_LOCK_WAIT_TIMEOUT) return new SpError(BUSY);
  return err;
}
