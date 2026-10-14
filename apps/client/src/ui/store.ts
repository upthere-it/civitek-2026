import type { InventoryItem } from '@sp/shared';

/**
 * Stato del giocatore così come l'ha mandato il server (qui non si calcola niente) e avvisi ai pannelli aperti.
 * - inventory: saldo, valore armadio o scarpe cambiati;
 * - market: la bacheca è cambiata;
 * - asset: il passaporto di una scarpa ha un anello nuovo o certificato (detail = assetId).
 */
export const store = {
  me: { id: 0, nickname: '' },
  coins: 0,
  wardrobeValue: 0,
  inventory: [] as InventoryItem[],
  /** serverTime − Date.now() a state.init: corregge l'orologio del telefono per i "3 min fa". */
  clockOffset: 0,
};

type Topic = 'inventory' | 'market' | 'asset';
const bus = new EventTarget();

export function publish(topic: Topic, detail?: number): void {
  bus.dispatchEvent(new CustomEvent(topic, { detail }));
}

/** Iscrizione di un pannello aperto: restituisce la funzione per disiscriversi alla chiusura. */
export function subscribe(topic: Topic, fn: (detail: number | undefined) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<number | undefined>).detail);
  bus.addEventListener(topic, h);
  return () => bus.removeEventListener(topic, h);
}

export const isMine = (playerId: number) => playerId === store.me.id;
