// Giocatori simulati via socket.io, per `npm run loadtest` e `npm run sim:economy`.
// Si comportano come il client vero: intenzioni via eventi con ack, stato solo da quello che manda il server.
import { randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  C2S,
  S2C,
  cellCenter,
  parseVillage,
  walkableCell,
  type Ack,
  type ClientToServerEvents,
  type DropInfo,
  type GameConfig,
  type InventoryItem,
  type Leaderboard,
  type ServerToClientEvents,
  type StateInit,
  type TiledMap,
  type Village,
} from '@sp/shared';
import { io, type Socket } from 'socket.io-client';
import { REPO_ROOT } from './env';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export const config = JSON.parse(readFileSync(join(REPO_ROOT, 'data', 'game_config.json'), 'utf8')) as GameConfig;

const ACK_TIMEOUT_MS = 5000;

/** Errori di gioco attesi (saldo, annuncio già venduto…): non sono guasti del server. */
const EXPECTED = new Set([
  'NO_FUNDS',
  'LISTING_CLOSED',
  'LISTING_NOT_FOUND',
  'NOT_OWNER',
  'NOT_FOR_SALE',
  'INVENTORY_FULL',
  'DROP_SOLDOUT',
  'DROP_CLOSED',
  'DROP_ALREADY_CLAIMED',
  'ASSET_LOCKED',
  'ALREADY_LISTED',
  'ALREADY_VERIFIED',
  'LEGEND_COOLDOWN',
  'LEGEND_MAXED',
  'SELF_BUY',
  'PRICE_OUT_OF_RANGE',
]);

/** Latenze degli ack per evento ed errori, di tutti i client insieme. */
export class Stats {
  readonly latency = new Map<string, number[]>();
  readonly expected = new Map<string, number>();
  readonly failures = new Map<string, number>();
  connected = 0;
  disconnects = 0;

  record(event: string, ms: number): void {
    const list = this.latency.get(event) ?? [];
    list.push(ms);
    this.latency.set(event, list);
  }

  error(event: string, code: string): void {
    const map = EXPECTED.has(code) ? this.expected : this.failures;
    const key = EXPECTED.has(code) ? code : `${event}:${code}`;
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  failureCount(): number {
    return [...this.failures.values()].reduce((a, b) => a + b, 0);
  }
}

export const percentile = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);

/** Comportamento di un giocatore: pesi delle azioni e scelte di prezzo. */
export interface Profile {
  name: string;
  weights: Partial<Record<Action, number>>;
  /** Probabilità di andare a un drop appena annunciato. */
  dropChance: number;
  /** Prezzo di vendita in bacheca rispetto al valore percepito. */
  sellFactor: number;
  /** Compra in bacheca solo se il prezzo è sotto valore × questo. */
  buyBelow: number;
  /** Fa verificare dalla Dott.ssa Hash le scarpe comprate da Tony. */
  verifiesStall: boolean;
}

export type Action =
  | 'move'
  | 'emote'
  | 'marketList'
  | 'passport'
  | 'leaderboard'
  | 'shopList'
  | 'stallList'
  | 'shopBuy'
  | 'listingCreate'
  | 'listingBuy'
  | 'stallBuy'
  | 'auth'
  | 'legend';

let village: Village | null = null;
function walkablePoint(): { x: number; y: number } {
  village ??= parseVillage(JSON.parse(readFileSync(join(REPO_ROOT, 'apps', 'client', 'public', config.world.map), 'utf8')) as TiledMap);
  const g = village.grid;
  for (;;) {
    const cx = randomInt(g.cols);
    const cy = randomInt(g.rows);
    if (walkableCell(g, cx, cy)) return cellCenter(g, cx, cy);
  }
}

const pick = <T>(list: readonly T[]): T => list[randomInt(list.length)];

/** Sotto queste monete (la scarpa più economica del Negozio ne costa 22) si svende per tornare liquidi. */
const CASH_LOW = 20;
/** Il preset "Svendi" del client (texts.ts pricePresets). */
const SVENDI = 0.8;

export class SimClient {
  readonly socket: GameSocket;
  playerId = 0;
  coins = 0;
  wardrobeValue = 0;
  inventory: InventoryItem[] = [];
  leaderboard: Leaderboard | null = null;
  private stopped = false;
  private ready!: Promise<void>;

  constructor(
    url: string,
    readonly profile: Profile,
    private readonly stats: Stats,
    private readonly thinkMs: number,
  ) {
    this.socket = io(url, { auth: { deviceId: randomUUID() }, forceNew: true, reconnection: false });
    this.socket.on('disconnect', (reason) => {
      if (!this.stopped) {
        this.stats.disconnects++;
        this.stats.error('socket', `DISCONNECT_${reason}`);
      }
    });
    this.socket.on(S2C.ERROR, (e) => this.stats.error('server', e.code));
    this.socket.on(S2C.INVENTORY_UPDATED, (m) => {
      this.coins = m.coins;
      this.wardrobeValue = m.wardrobeValue;
      this.inventory = m.inventory;
    });
    this.socket.on(S2C.LEADERBOARD_UPDATED, (b) => (this.leaderboard = b));
    this.socket.on(S2C.DROP_ANNOUNCE, (d) => void this.onDrop(d));
    this.ready = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('state.init non arrivato')), 15_000);
      this.socket.once(S2C.STATE_INIT, (s) => {
        clearTimeout(t);
        void this.enter(s).then(resolve, reject);
      });
    });
  }

  /** Connessione e avatar (stessi passi della landing e della creazione del personaggio). */
  start(): Promise<void> {
    return this.ready.catch(() => this.stats.error('connect', 'NO_STATE_INIT'));
  }

  private async enter(s: StateInit): Promise<void> {
    this.playerId = s.player.id;
    this.coins = s.player.coins;
    this.wardrobeValue = s.wardrobeValue;
    this.inventory = s.inventory;
    this.stats.connected++;
    if (!s.player.avatar) {
      const a = config.avatar;
      const body = randomInt(a.body_types.length);
      const hairs = a.hair_by_body[a.body_types[body]];
      await this.req(C2S.AVATAR_SET, {
        body,
        skin: randomInt(a.skin_tones.length),
        hair: pick(hairs),
        hairColor: randomInt(a.hair_colors.length),
        outfit: randomInt(a.outfit_colors.length),
        nickname: s.player.nickname,
      });
    }
  }

  /** Il ciclo di gioco fino a `until`: un'azione, una pausa (think time), un'altra azione. */
  async play(until: number): Promise<void> {
    while (!this.stopped && Date.now() < until && this.socket.connected) {
      await this.act(this.choose());
      await sleep(this.thinkMs / 2 + randomInt(this.thinkMs));
    }
  }

  stop(): void {
    this.stopped = true;
    this.socket.disconnect();
  }

  /** Richiesta con ack misurata. Restituisce i dati o null (errore registrato). */
  async req<T>(event: string, payload: unknown): Promise<T | null> {
    const t0 = performance.now();
    try {
      const res = (await (this.socket.timeout(ACK_TIMEOUT_MS) as unknown as { emitWithAck(e: string, p: unknown): Promise<Ack<T>> }).emitWithAck(
        event,
        payload,
      )) as Ack<T>;
      this.stats.record(event, performance.now() - t0);
      if (!res.ok) {
        this.stats.error(event, res.code);
        return null;
      }
      return res.data;
    } catch {
      this.stats.error(event, 'TIMEOUT');
      return null;
    }
  }

  private choose(): Action {
    const entries = Object.entries(this.profile.weights) as [Action, number][];
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let x = Math.random() * total;
    for (const [a, w] of entries) {
      x -= w;
      if (x < 0) return a;
    }
    return entries[0][0];
  }

  private unlisted(): InventoryItem[] {
    const now = Date.now();
    return this.inventory.filter((i) => i.listingId === null && (i.lockedUntil === null || i.lockedUntil < now));
  }

  private async act(a: Action): Promise<void> {
    const e = config.economy;
    switch (a) {
      case 'move':
        await this.req(C2S.MOVE_TO, walkablePoint());
        break;
      case 'emote':
        await this.req(C2S.EMOTE_SEND, { emote: pick(config.world.emotes) });
        break;
      case 'marketList':
        await this.req(C2S.MARKET_LIST, {});
        break;
      case 'passport': {
        const own = this.inventory[0];
        if (own) await this.req(C2S.PASSPORT_GET, { assetId: own.assetId });
        break;
      }
      case 'leaderboard': {
        const b = await this.req<Leaderboard>(C2S.LEADERBOARD_GET, {});
        if (b) this.leaderboard = b;
        break;
      }
      case 'shopList':
        await this.req(C2S.SHOP_LIST, {});
        break;
      case 'stallList':
        await this.req(C2S.STALL_LIST, {});
        break;
      case 'shopBuy': {
        const shop = await this.req<{ itemId: string; price: number }[]>(C2S.SHOP_LIST, {});
        const affordable = (shop ?? []).filter((s) => s.price <= this.coins);
        if (affordable.length) await this.req(C2S.SHOP_BUY, { itemId: pick(affordable).itemId });
        break;
      }
      case 'listingCreate': {
        const free = this.unlisted();
        if (!free.length) break;
        const it = pick(free);
        // senza monete per comprare niente si svende (il preset "Svendi" del selettore di prezzo)
        const factor = this.coins < CASH_LOW ? SVENDI : this.profile.sellFactor;
        const price = Math.max(e.listing_min_price, Math.min(it.maxListPrice, Math.round(it.perceivedValue * factor)));
        await this.req(C2S.LISTING_CREATE, { assetId: it.assetId, price });
        break;
      }
      case 'listingBuy': {
        const page = await this.req<{ listings: { listingId: number; price: number; perceivedValue: number; sellerId: number }[] }>(C2S.MARKET_LIST, {});
        const deals = (page?.listings ?? []).filter(
          (l) => l.sellerId !== this.playerId && l.price <= this.coins && l.price < l.perceivedValue * this.profile.buyBelow,
        );
        if (deals.length) {
          deals.sort((x, y) => x.price / x.perceivedValue - y.price / y.perceivedValue);
          await this.req(C2S.LISTING_BUY, { listingId: deals[0].listingId });
        }
        break;
      }
      case 'stallBuy': {
        const offers = await this.req<{ assetId: number; price: number }[]>(C2S.STALL_LIST, {});
        const affordable = (offers ?? []).filter((o) => o.price <= this.coins);
        if (!affordable.length) break;
        const bought = await this.req<{ assetId: number }>(C2S.STALL_BUY, { assetId: pick(affordable).assetId });
        if (bought && this.profile.verifiesStall) await this.req(C2S.AUTH_REQUEST, { assetId: bought.assetId });
        break;
      }
      case 'auth': {
        const unknown = this.unlisted().filter((i) => i.status === null);
        if (unknown.length && this.coins >= e.auth_cost) await this.req(C2S.AUTH_REQUEST, { assetId: pick(unknown).assetId });
        break;
      }
      case 'legend': {
        const free = this.unlisted().filter((i) => i.status !== 'fake');
        if (!free.length || this.coins < e.legend.cost) break;
        free.sort((x, y) => y.perceivedValue - x.perceivedValue);
        await this.req(C2S.LEGEND_REQUEST, { assetId: free[0].assetId });
        break;
      }
    }
  }

  private async onDrop(d: DropInfo): Promise<void> {
    if (this.stopped || Math.random() >= this.profile.dropChance || d.price > this.coins) return;
    await sleep(randomInt(3000)); // il tempo di vedere il banner e toccare "Vai"
    await this.req(C2S.DROP_CLAIM, { dropId: d.dropId });
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Argomenti `--chiave valore` della riga di comando. */
export function args(): Record<string, string> {
  const out: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const next = argv[i + 1];
    out[argv[i].slice(2)] = next && !next.startsWith('--') ? (i++, next) : 'true';
  }
  return out;
}

/** Il carico finto non va su un server altrui per sbaglio: fuori da localhost serve `--yes`. */
export function checkTarget(url: string, a: Record<string, string>): void {
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host) && a.yes !== 'true') {
    console.error(`${url} non è locale: i giocatori finti finirebbero in classifica e nel DB. Aggiungi --yes se è voluto.`);
    process.exit(2);
  }
}

/** Avvia `n` client distribuiti su `rampMs`. */
export async function spawn(n: number, rampMs: number, make: (i: number) => SimClient): Promise<SimClient[]> {
  const clients: SimClient[] = [];
  await Promise.all(
    Array.from({ length: n }, async (_, i) => {
      await sleep((rampMs * i) / n);
      const c = make(i);
      clients.push(c);
      await c.start();
    }),
  );
  return clients;
}
