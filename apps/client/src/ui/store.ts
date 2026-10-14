import type { DropState, InventoryItem, Leaderboard } from '@sp/shared';

/**
 * Stato del giocatore così come l'ha mandato il server (qui non si calcola niente) e avvisi ai pannelli aperti.
 * - inventory: saldo, valore armadio o scarpe cambiati;
 * - market: la bacheca è cambiata;
 * - asset: il passaporto di una scarpa ha un anello nuovo o certificato (detail = assetId);
 * - stall: il banco di Tony Affari è cambiato;
 * - drop: drop aperto, aggiornato o chiuso (store.drop);
 * - leaderboard: la classifica live è cambiata (store.leaderboard);
 * - tick: un secondo è passato (conti alla rovescia nei pannelli aperti).
 */
export const store = {
  me: { id: 0, nickname: '' },
  coins: 0,
  wardrobeValue: 0,
  inventory: [] as InventoryItem[],
  /** serverTime − Date.now() a state.init: corregge l'orologio del telefono per i "3 min fa". */
  clockOffset: 0,
  drop: { current: null, nextAt: 0 } as DropState,
  /** Epoch ms (orologio del server): da quando MC Suola accetta un'altra scarpa. */
  legendReadyAt: null as number | null,
  /** Classifica live: arriva con leaderboard.get all'ingresso e poi da sola (leaderboard.updated). */
  leaderboard: null as Leaderboard | null,
};

/** Adesso, sull'orologio del server. */
export const serverNow = () => Date.now() + store.clockOffset;

type Topic = 'inventory' | 'market' | 'asset' | 'stall' | 'drop' | 'leaderboard' | 'tick';
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
