// Payload del protocollo socket (ARCHITECTURE §5). Il client manda intenzioni, mai stati.
import { C2S, S2C } from './events';
import type { AssetCertified, AssetEventType, ChainStatus } from './types';
import type { Facing } from './village';

/** Indici nelle liste di game_config.avatar. */
export interface AvatarLook {
  /** avatar.body_types: 0 ragazzo, 1 ragazza. */
  body: number;
  skin: number;
  hair: number;
  hairColor: number;
  outfit: number;
}

export interface AvatarSet extends AvatarLook {
  nickname: string;
}

/** Handshake socket.io (`io(url, { auth })`). */
export interface HandshakeAuth {
  /** UUID v4 casuale generato dal client: l'unico dato salvato sul telefono. */
  deviceId: string;
}

/** Risposta (ack) a ogni richiesta client → server. */
export type Ack<T = undefined> = { ok: true; data: T } | { ok: false; code: string; message: string };

export interface InventoryItem {
  assetId: number;
  publicId: string;
  itemId: string;
  serial: number;
  perceivedValue: number;
  /** Annuncio aperto in bacheca, se c'è. */
  listingId: number | null;
  listingPrice: number | null;
  /** Prezzo massimo ammesso per metterla in bacheca (il minimo è economy.listing_min_price). */
  maxListPrice: number;
  /** Verdetto della Dott.ssa Hash, se c'è stato. */
  status: PassportStatus;
  /** Epoch ms: fino a quando è da MC Suola; null se è nell'armadio. */
  lockedUntil: number | null;
  legendCount: number;
}

/** Un falso sul banco di Tony Affari (lo sprite è identico all'originale: lo tradisce solo il passaporto). */
export interface StallOffer {
  assetId: number;
  itemId: string;
  serial: number;
  price: number;
  perceivedValue: number;
}

/** Drop della Banca Upthere (GAME_DESIGN §11). Orari in epoch ms. */
export interface DropInfo {
  dropId: number;
  itemId: string;
  quantity: number;
  sold: number;
  price: number;
  closesAt: number;
}

export interface DropState {
  current: DropInfo | null;
  /** Quando apre il prossimo (orologio di mondo, uguale per tutti). */
  nextAt: number;
}

export interface ShopEntry {
  itemId: string;
  price: number;
}

export interface Listing {
  listingId: number;
  assetId: number;
  itemId: string;
  serial: number;
  price: number;
  perceivedValue: number;
  sellerId: number;
  sellerName: string;
}

export interface MarketPage {
  listings: Listing[];
  /** Da passare a market.list per la pagina successiva; null se finite. */
  nextCursor: number | null;
}

export type PassportStatus = 'authentic' | 'fake' | null;

export interface PassportEvent {
  id: number;
  event: AssetEventType;
  fromId: number | null;
  fromName: string | null;
  toId: number;
  toName: string;
  price: number;
  /** Il destinatario è un account di sistema (bot, Tony, MC Suola): serve a scrivere bene l'anello. */
  toSystem: boolean;
  hash: string;
  prevHash: string | null;
  /** Epoch ms (UNIX_TIMESTAMP lato DB): non dipende dal fuso di server e telefono. */
  at: number;
  chainStatus: ChainStatus;
  txHash: string | null;
  explorerUrl: string | null;
}

/** Passaporto di una scarpa (GAME_DESIGN §7): si può aprire per qualunque asset, anche prima di comprarlo. */
export interface Passport {
  assetId: number;
  publicId: string;
  itemId: string;
  serial: number;
  /** Chi l'ha coniata: Negozio, Banca Upthere (drop), Tony Affari (falsi). */
  origin: 'shop' | 'upthere' | 'stall' | 'other';
  dropSerial: number | null;
  dropQuantity: number | null;
  perceivedValue: number;
  /** ✅ autentica (verificata) / ❌ falsa (smascherata) / null se mai verificata. Mai is_fake in chiaro. */
  status: PassportStatus;
  legendCount: number;
  ownerId: number;
  ownerName: string;
  /** Epoch ms: fino a quando è da MC Suola (non si può vendere). */
  lockedUntil: number | null;
  listing: { listingId: number; price: number; sellerId: number } | null;
  /** In vendita da Tony Affari a questo prezzo (owner = bancarella). */
  stallPrice: number | null;
  events: PassportEvent[];
}

/** Dopo un'azione economica: saldo, valore armadio e scarpe del giocatore. */
export interface InventoryUpdated {
  coins: number;
  wardrobeValue: number;
  inventory: InventoryItem[];
}

/** `run.beat`: un suggerimento dei primi minuti nel villaggio (first_run.beats). */
export interface RunBeat {
  beatId: string;
}

export interface LeaderboardRow {
  rank: number;
  playerId: number;
  nickname: string;
  look: AvatarLook;
  shoesColor: string | null;
  value: number;
}

/**
 * Classifica live (GAME_DESIGN §13): top per valore armadio e la propria posizione, anche fuori dalla top.
 * Arriva con `leaderboard.get` e poi da sola (`leaderboard.updated`) quando cambia qualcosa.
 */
export interface Leaderboard {
  top: LeaderboardRow[];
  me: LeaderboardRow | null;
}

export interface StateInit {
  serverTime: number;
  player: {
    id: number;
    nickname: string;
    avatar: AvatarLook | null;
    coins: number;
    /** palette.upper della scarpa con valore percepito più alto (colore delle scarpe dell'avatar). */
    shoesColor: string | null;
    /** Epoch ms: da quando MC Suola accetta un'altra scarpa da questo giocatore. */
    legendReadyAt: number | null;
  };
  drop: DropState;
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
  /** Il passaporto dell'asset è cambiato (nuovo anello): chi lo ha aperto lo ricarica. */
  [S2C.ASSET_UPDATED]: (m: { assetId: number }) => void;
  [S2C.INVENTORY_UPDATED]: (m: InventoryUpdated) => void;
  /** La bacheca è cambiata: chi la sta guardando la ricarica. */
  [S2C.MARKET_UPDATED]: () => void;
  /** Il banco di Tony Affari è cambiato (rifornimento o vendita). */
  [S2C.STALL_UPDATED]: () => void;
  [S2C.DROP_ANNOUNCE]: (d: DropInfo) => void;
  [S2C.DROP_UPDATE]: (m: { dropId: number; sold: number }) => void;
  [S2C.DROP_CLOSED]: (m: { dropId: number; nextAt: number }) => void;
  /** MC Suola ha restituito la scarpa (al proprietario). */
  [S2C.LEGEND_RETURNED]: (m: { assetId: number }) => void;
  /** Un suggerimento dei primi minuti (first_run.beats). */
  [S2C.RUN_BEAT]: (m: RunBeat) => void;
  /** La classifica è cambiata: top e la propria posizione. */
  [S2C.LEADERBOARD_UPDATED]: (m: Leaderboard) => void;
  [S2C.ERROR]: (e: ErrorEvent) => void;
}

/** Eventi client → server, tutti con ack. */
export interface ClientToServerEvents {
  /** Creazione del personaggio: aspetto e nome (proposto dal gioco, modificabile solo qui). */
  [C2S.AVATAR_SET]: (p: AvatarSet, ack: (r: Ack<{ x: number; y: number; nickname: string }>) => void) => void;
  [C2S.MOVE_TO]: (p: MoveTo, ack: (r: Ack<{ x: number; y: number }>) => void) => void;
  [C2S.EMOTE_SEND]: (p: { emote: string }, ack: (r: Ack) => void) => void;
  [C2S.SHOP_LIST]: (p: Record<string, never>, ack: (r: Ack<ShopEntry[]>) => void) => void;
  [C2S.SHOP_BUY]: (p: { itemId: string }, ack: (r: Ack<{ assetId: number }>) => void) => void;
  [C2S.MARKET_LIST]: (p: { cursor?: number }, ack: (r: Ack<MarketPage>) => void) => void;
  [C2S.LISTING_CREATE]: (p: { assetId: number; price: number }, ack: (r: Ack<{ listingId: number }>) => void) => void;
  [C2S.LISTING_CANCEL]: (p: { listingId: number }, ack: (r: Ack) => void) => void;
  [C2S.LISTING_BUY]: (p: { listingId: number }, ack: (r: Ack<{ assetId: number }>) => void) => void;
  [C2S.PASSPORT_GET]: (p: { assetId: number }, ack: (r: Ack<Passport>) => void) => void;
  [C2S.STALL_LIST]: (p: Record<string, never>, ack: (r: Ack<StallOffer[]>) => void) => void;
  [C2S.STALL_BUY]: (p: { assetId: number }, ack: (r: Ack<{ assetId: number; price: number }>) => void) => void;
  [C2S.AUTH_REQUEST]: (p: { assetId: number }, ack: (r: Ack<{ verdict: 'genuine' | 'fake' }>) => void) => void;
  [C2S.LEGEND_REQUEST]: (p: { assetId: number }, ack: (r: Ack<{ until: number }>) => void) => void;
  [C2S.DROP_STATE]: (p: Record<string, never>, ack: (r: Ack<DropState>) => void) => void;
  [C2S.DROP_CLAIM]: (p: { dropId: number }, ack: (r: Ack<{ assetId: number }>) => void) => void;
  [C2S.LEADERBOARD_GET]: (p: Record<string, never>, ack: (r: Ack<Leaderboard>) => void) => void;
}
