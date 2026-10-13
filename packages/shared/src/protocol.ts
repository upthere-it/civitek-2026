// Payload del protocollo socket (ARCHITECTURE §5). Il client manda intenzioni, mai stati.
import { C2S, S2C } from './events';
import type { AssetCertified } from './types';
import type { Facing } from './village';

/** Indici nelle liste di game_config.avatar. */
export interface AvatarLook {
  skin: number;
  hair: number;
  hairColor: number;
  outfit: number;
}

/** Risposta (ack) a ogni richiesta client → server. */
export type Ack<T = undefined> = { ok: true; data: T } | { ok: false; code: string; message: string };

export interface InventoryItem {
  assetId: number;
  publicId: string;
  itemId: string;
  serial: number;
  perceivedValue: number;
}

export interface StateInit {
  serverTime: number;
  player: {
    id: number;
    nickname: string;
    avatar: AvatarLook | null;
    coins: number;
    /** Codice di recupero "XXX-XXX": il DB ne ha solo l'hash, il server lo ricava dal device. */
    recoveryCode: string | null;
    /** palette.upper della scarpa con valore percepito più alto (colore delle scarpe dell'avatar). */
    shoesColor: string | null;
  };
  inventory: InventoryItem[];
  wardrobeValue: number;
  /** Posizione nel villaggio; null finché l'avatar non è pronto. */
  position: { x: number; y: number } | null;
}

/** Profilo di un altro giocatore, mandato la prima volta che entra nel raggio visibile. */
export interface PlayerProfile {
  nickname: string;
  look: AvatarLook;
  shoesColor: string | null;
}

export interface PlayerSnapshot {
  id: number;
  x: number;
  y: number;
  facing: Facing;
  moving: boolean;
  /**
   * Percorso ancora da fare (solo se moving). Server e client usano la stessa findPath/advance: il client
   * simula il cammino da solo, quindi il server manda un messaggio quando si parte e uno quando ci si
   * ferma, non una posizione a ogni tick.
   */
  path?: [number, number][];
  /** Presente solo la prima volta (o se cambia). */
  profile?: PlayerProfile;
}

/** `world.players`: cambi nel raggio (partenze, arrivi, ingressi, profili), controllati a world.tick_hz. */
export interface WorldPlayers {
  t: number;
  players: PlayerSnapshot[];
  /** Usciti dal raggio o disconnessi. */
  gone: number[];
}

export interface WorldEmote {
  playerId: number;
  emote: string;
}

export interface MoveTo {
  x: number;
  y: number;
}

export interface WalletUpdated {
  coins: number;
  wardrobeValue: number;
}

export interface ErrorEvent {
  code: string;
  message: string;
}

/** Eventi server → client (tipizzano socket.io su entrambi i lati). */
export interface ServerToClientEvents {
  [S2C.STATE_INIT]: (s: StateInit) => void;
  [S2C.WORLD_PLAYERS]: (m: WorldPlayers) => void;
  [S2C.WORLD_EMOTE]: (m: WorldEmote) => void;
  [S2C.WALLET_UPDATED]: (m: WalletUpdated) => void;
  [S2C.ASSET_CERTIFIED]: (m: AssetCertified) => void;
  [S2C.ERROR]: (e: ErrorEvent) => void;
}

/** Eventi client → server, tutti con ack. */
export interface ClientToServerEvents {
  [C2S.AVATAR_SET]: (look: AvatarLook, ack: (r: Ack<{ x: number; y: number }>) => void) => void;
  [C2S.MOVE_TO]: (p: MoveTo, ack: (r: Ack<{ x: number; y: number }>) => void) => void;
  [C2S.EMOTE_SEND]: (p: { emote: string }, ack: (r: Ack) => void) => void;
}
