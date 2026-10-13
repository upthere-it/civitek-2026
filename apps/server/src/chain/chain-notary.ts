export interface NotarizeItem {
  eventId: number;
  hash: string;
}

export interface ChainNotary {
  readonly network: string;
  notarizeBatch(items: NotarizeItem[]): Promise<{ txHash: string }>;
  /** Link all'explorer della tx; stringa vuota se non esiste (es. MockNotary). */
  explorerUrl(txHash: string): string;
}

export const CHAIN_NOTARY = Symbol('CHAIN_NOTARY');

export const NOTARY_APP = 'sneaker-passport';

/**
 * Il solo contenuto che va on-chain: id interni degli eventi e hash. Niente nickname, device o id dei
 * giocatori: la chain è immutabile e gli utenti sono minorenni (ARCHITECTURE §6).
 */
export function notaryPayload(items: readonly NotarizeItem[]): string {
  return JSON.stringify({ v: 1, app: NOTARY_APP, events: items.map((i) => [i.eventId, i.hash]) });
}
