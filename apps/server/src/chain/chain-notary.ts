import { createHash } from 'node:crypto';

export interface NotarizeItem {
  eventId: number;
  hash: string;
}

export interface ChainNotary {
  readonly network: string;
  /** `batchId` (UUID v4) è anche l'id del documento on-chain: con lui si ritrova il batch da verificare. */
  notarizeBatch(items: NotarizeItem[], batchId: string): Promise<{ txHash: string }>;
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

/** Impronta del batch: è il checksum che va on-chain (hash cumulativo, come in ms-carma-advisory). */
export function batchHash(items: readonly NotarizeItem[]): string {
  return createHash('sha256').update(notaryPayload(items)).digest('hex');
}

/** {txHash} → link all'explorer della testnet (chain.explorer_tx_url). */
export function explorerTxUrl(template: string, txHash: string): string {
  return template.includes('{txHash}') ? template.replace('{txHash}', txHash) : '';
}
