import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  C2S,
  S2C,
  errorMessage,
  type Ack,
  type AvatarLook,
  type ClientToServerEvents,
  type DropState,
  type InventoryUpdated,
  type Leaderboard,
  type MarketPage,
  type MoveTo,
  type Passport,
  type ServerToClientEvents,
  type ShopEntry,
  type StallOffer,
  type StateInit,
  type WorldEmote,
} from '@sp/shared';
import type { Subscription } from 'rxjs';
import type { Server, Socket } from 'socket.io';
import { ChainEventsService } from '../chain/chain-events.service';
import { GameConfigService } from '../config/game-config.service';
import { SpError } from '../db/sp-error';
import { AssetsService } from './assets.service';
import { DropService } from './drop.service';
import { GameEventsService, type GameEvent } from './game-events.service';
import { isDeviceId } from './identity';
import { LeaderboardService } from './leaderboard.service';
import { MarketService } from './market.service';
import { MechanicsService } from './mechanics.service';
import { PlayerService, type PlayerState } from './player.service';
import { RateLimiter } from './rate-limit';
import { RunService } from './run.service';
import { WorldService } from './world.service';

interface SocketData {
  deviceId: string;
  playerId?: number;
  limiter: RateLimiter;
}

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const fail = (code: string): Ack<never> => ({ ok: false, code, message: errorMessage(code) });

/** Tempo che il client ha per chiudere da solo una sessione rifiutata. */
const REJECT_GRACE_MS = 1000;

const isId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;

/** Room di chi ha aperto il passaporto di un asset: riceve certificazioni e nuovi anelli in diretta. */
const assetRoom = (assetId: number) => `asset:${assetId}`;

/**
 * Gateway socket.io: sessione dal device_id dell'handshake, presenza, emote. Il client manda intenzioni
 * (move.to, avatar.set, emote.send), mai stati. Ogni richiesta ha una risposta (ack) `Ack<T>`.
 */
@WebSocketGateway({ serveClient: false })
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  static readonly WORLD_TICK = 'world-tick';

  @WebSocketServer() private server!: Server<ClientToServerEvents, ServerToClientEvents>;
  private readonly logger = new Logger(GameGateway.name);
  /** playerId → socket attivo (uno solo: una nuova scheda sostituisce la vecchia) */
  private readonly sockets = new Map<number, GameSocket>();
  private certified?: Subscription;
  private gameEvents?: Subscription;

  constructor(
    private readonly players: PlayerService,
    private readonly world: WorldService,
    private readonly cfg: GameConfigService,
    private readonly chainEvents: ChainEventsService,
    private readonly scheduler: SchedulerRegistry,
    private readonly market: MarketService,
    private readonly assets: AssetsService,
    private readonly mechanics: MechanicsService,
    private readonly drops: DropService,
    private readonly events: GameEventsService,
    private readonly runs: RunService,
    private readonly leaderboard: LeaderboardService,
  ) {}

  onModuleInit(): void {
    const hz = this.cfg.config.world.tick_hz;
    const handle = setInterval(() => this.tick(1 / hz), 1000 / hz);
    this.scheduler.addInterval(GameGateway.WORLD_TICK, handle);
    this.certified = this.chainEvents.certified$.subscribe((batch) => {
      for (const n of batch) {
        const payload = { assetId: n.assetId, eventId: n.eventId, txHash: n.txHash, explorerUrl: n.explorerUrl };
        // chi ha il passaporto aperto + i giocatori coinvolti (socket.io consegna una volta sola a socket)
        const rooms = [assetRoom(n.assetId), ...[n.fromId, n.toId].flatMap((id) => this.socketRoom(id))];
        this.server.to(rooms).emit(S2C.ASSET_CERTIFIED, payload);
      }
    });
    this.gameEvents = this.events.events$.subscribe((e) => void this.forward(e));
  }

  /** Inoltra ai client quello che succede nei loop (bot, bancarella, drop, MC Suola). */
  private async forward(e: GameEvent): Promise<void> {
    try {
      switch (e.type) {
        case 'market':
          this.server.emit(S2C.MARKET_UPDATED);
          break;
        case 'stall':
          this.server.emit(S2C.STALL_UPDATED);
          break;
        case 'players':
          await this.refreshPlayers(...e.ids);
          break;
        case 'asset':
          this.server.to(assetRoom(e.assetId)).emit(S2C.ASSET_UPDATED, { assetId: e.assetId });
          break;
        case 'legend.returned':
          this.server.to(assetRoom(e.assetId)).emit(S2C.ASSET_UPDATED, { assetId: e.assetId });
          this.sockets.get(e.ownerId)?.emit(S2C.LEGEND_RETURNED, { assetId: e.assetId });
          await this.refreshPlayers(e.ownerId);
          break;
        case 'drop.announce':
          this.server.emit(S2C.DROP_ANNOUNCE, e.drop);
          break;
        case 'drop.update':
          this.server.emit(S2C.DROP_UPDATE, { dropId: e.dropId, sold: e.sold });
          break;
        case 'drop.closed':
          this.server.emit(S2C.DROP_CLOSED, { dropId: e.dropId, nextAt: e.nextAt });
          break;
        case 'run.beat':
          this.sockets.get(e.playerId)?.emit(S2C.RUN_BEAT, { beatId: e.beatId });
          break;
        case 'leaderboard':
          for (const [id, socket] of this.sockets) socket.emit(S2C.LEADERBOARD_UPDATED, this.leaderboard.boardFor(e.rows, id));
          break;
      }
    } catch (err) {
      this.logger.error(`inoltro di ${e.type} fallito: ${String(err)}`);
    }
  }

  onModuleDestroy(): void {
    if (this.scheduler.doesExist('interval', GameGateway.WORLD_TICK)) this.scheduler.deleteInterval(GameGateway.WORLD_TICK);
    this.certified?.unsubscribe();
    this.gameEvents?.unsubscribe();
  }

  async handleConnection(socket: GameSocket): Promise<void> {
    const deviceId: unknown = socket.handshake.auth?.deviceId;
    if (!isDeviceId(deviceId)) return this.reject(socket, 'DEVICE_INVALID');
    socket.data = { deviceId, limiter: new RateLimiter(this.cfg.player.rate_limit_actions_per_sec) };
    try {
      const { playerId } = await this.players.getOrCreate(deviceId);
      if (!socket.connected) return;
      const previous = this.sockets.get(playerId);
      if (previous && previous.id !== socket.id) {
        previous.emit(S2C.ERROR, { code: 'SESSION_REPLACED', message: errorMessage('SESSION_REPLACED') });
        previous.disconnect(true);
      }
      socket.data.playerId = playerId;
      this.sockets.set(playerId, socket);

      const state = await this.players.loadState(playerId);
      let position = null;
      if (state.look) {
        if (!this.world.has(playerId) && this.world.size >= this.cfg.config.world.max_players_per_room) {
          return this.reject(socket, 'WORLD_FULL');
        }
        position = this.world.join(playerId, this.profileOf(state));
        await this.runs.enter(playerId, state.wardrobeValue);
      }
      if (!socket.connected) return;
      socket.emit(S2C.STATE_INIT, this.stateInit(state, position));
    } catch (err) {
      const code = err instanceof SpError ? err.code : 'INTERNAL';
      this.logger.error(`handshake fallito: ${String(err)}`);
      this.reject(socket, code);
    }
  }

  handleDisconnect(socket: GameSocket): void {
    const id = socket.data?.playerId;
    if (id !== undefined && this.sockets.get(id)?.id === socket.id) {
      this.sockets.delete(id);
      this.world.leave(id);
      this.runs.leave(id);
    }
  }

  @SubscribeMessage(C2S.AVATAR_SET)
  async onAvatarSet(
    @ConnectedSocket() socket: GameSocket,
    @MessageBody() body: unknown,
  ): Promise<Ack<{ x: number; y: number; nickname: string }>> {
    const id = this.guard(socket);
    if (typeof id === 'string') return fail(id);
    const look = parseLook(body);
    if (!look) return fail('AVATAR_INVALID');
    const nickname = (body as { nickname?: unknown }).nickname;
    if (nickname !== undefined && typeof nickname !== 'string') return fail('NICKNAME_INVALID');
    try {
      const saved = await this.players.setProfile(id, look, nickname ?? null);
      const state = await this.players.loadState(id);
      if (this.world.size >= this.cfg.config.world.max_players_per_room) return fail('WORLD_FULL');
      const position = this.world.join(id, this.profileOf(state));
      // i suggerimenti dei primi minuti partono adesso, all'ingresso nel villaggio
      await this.runs.enter(id, state.wardrobeValue);
      return { ok: true, data: { ...position, nickname: saved } };
    } catch (err) {
      return this.failFrom(err);
    }
  }

  @SubscribeMessage(C2S.MOVE_TO)
  onMoveTo(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown): Ack<{ x: number; y: number }> {
    const id = this.guard(socket);
    if (typeof id === 'string') return fail(id);
    const target = body as MoveTo;
    if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return fail('INVALID_PAYLOAD');
    if (!this.world.has(id)) return fail('AVATAR_REQUIRED');
    const end = this.world.moveTo(id, { x: target.x, y: target.y });
    return end ? { ok: true, data: end } : fail('INVALID_PAYLOAD');
  }

  @SubscribeMessage(C2S.EMOTE_SEND)
  onEmote(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown): Ack {
    const id = this.guard(socket);
    if (typeof id === 'string') return fail(id);
    const emote = (body as { emote?: unknown })?.emote;
    if (typeof emote !== 'string' || !this.cfg.config.world.emotes.includes(emote)) return fail('INVALID_PAYLOAD');
    if (!this.world.has(id)) return fail('AVATAR_REQUIRED');
    const msg: WorldEmote = { playerId: id, emote };
    for (const viewer of this.world.nearby(id)) this.sockets.get(viewer)?.emit(S2C.WORLD_EMOTE, msg);
    return { ok: true, data: undefined };
  }

  // ------------------------------------------------------------------ negozio, bacheca, passaporto (M2)

  @SubscribeMessage(C2S.SHOP_LIST)
  onShopList(@ConnectedSocket() socket: GameSocket): Ack<ShopEntry[]> {
    const id = this.guard(socket);
    if (typeof id === 'string') return fail(id);
    return { ok: true, data: this.market.shopList() };
  }

  @SubscribeMessage(C2S.SHOP_BUY)
  async onShopBuy(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown): Promise<Ack<{ assetId: number }>> {
    const id = this.guard(socket);
    if (typeof id === 'string') return fail(id);
    const itemId = (body as { itemId?: unknown })?.itemId;
    if (typeof itemId !== 'string') return fail('INVALID_PAYLOAD');
    return this.run(async () => {
      const res = await this.market.shopBuy(id, itemId);
      await this.refreshPlayers(id);
      return res;
    });
  }

  @SubscribeMessage(C2S.MARKET_LIST)
  async onMarketList(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown): Promise<Ack<MarketPage>> {
    const id = this.guard(socket);
    if (typeof id === 'string') return fail(id);
    const cursor = (body as { cursor?: unknown })?.cursor;
    if (cursor !== undefined && !isId(cursor)) return fail('INVALID_PAYLOAD');
    return this.run(() => this.market.page(cursor));
  }

  @SubscribeMessage(C2S.LISTING_CREATE)
  async onListingCreate(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown): Promise<Ack<{ listingId: number }>> {
    const id = this.guard(socket);
    if (typeof id === 'string') return fail(id);
    const { assetId, price } = (body ?? {}) as { assetId?: unknown; price?: unknown };
    if (!isId(assetId) || !Number.isSafeInteger(price)) return fail('INVALID_PAYLOAD');
    return this.run(async () => {
      const res = await this.market.createListing(id, assetId, price as number);
      await this.refreshPlayers(id);
      this.server.emit(S2C.MARKET_UPDATED);
      this.server.to(assetRoom(assetId)).emit(S2C.ASSET_UPDATED, { assetId });
      return res;
    });
  }

  @SubscribeMessage(C2S.LISTING_CANCEL)
  async onListingCancel(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown): Promise<Ack> {
    const id = this.guard(socket);
    if (typeof id === 'string') return fail(id);
    const listingId = (body as { listingId?: unknown })?.listingId;
    if (!isId(listingId)) return fail('INVALID_PAYLOAD');
    return this.run(async () => {
      const { assetId } = await this.market.cancelListing(id, listingId);
      await this.refreshPlayers(id);
      this.server.emit(S2C.MARKET_UPDATED);
      this.server.to(assetRoom(assetId)).emit(S2C.ASSET_UPDATED, { assetId });
      return undefined;
    });
  }

  @SubscribeMessage(C2S.LISTING_BUY)
  async onListingBuy(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown): Promise<Ack<{ assetId: number }>> {
    const id = this.guard(socket);
    if (typeof id === 'string') return fail(id);
    const listingId = (body as { listingId?: unknown })?.listingId;
    if (!isId(listingId)) return fail('INVALID_PAYLOAD');
    return this.run(async () => {
      const { assetId, sellerId } = await this.market.buyListing(id, listingId);
      await this.refreshPlayers(id, sellerId);
      this.server.emit(S2C.MARKET_UPDATED);
      this.server.to(assetRoom(assetId)).emit(S2C.ASSET_UPDATED, { assetId });
      return { assetId };
    });
  }

  /** Passaporto di qualunque scarpa (anche prima di comprarla). Il socket entra nella room dell'asset. */
  @SubscribeMessage(C2S.PASSPORT_GET)
  async onPassport(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown): Promise<Ack<Passport>> {
    const id = this.guard(socket);
    if (typeof id === 'string') return fail(id);
    const assetId = (body as { assetId?: unknown })?.assetId;
    if (!isId(assetId)) return fail('INVALID_PAYLOAD');
    return this.run(async () => {
      const passport = await this.assets.passport(assetId);
      if (!passport) throw new SpError('ASSET_NOT_FOUND');
      // una room di passaporto alla volta per socket
      for (const room of socket.rooms) if (room.startsWith('asset:')) void socket.leave(room);
      void socket.join(assetRoom(assetId));
      return passport;
    });
  }

  // ------------------------------------------------------------------ Tony Affari, Dott.ssa Hash, MC Suola, drop (M3)

  @SubscribeMessage(C2S.STALL_LIST)
  async onStallList(@ConnectedSocket() socket: GameSocket): Promise<Ack<StallOffer[]>> {
    const id = this.guard(socket);
    if (typeof id === 'string') return fail(id);
    return this.run(() => this.mechanics.stallList());
  }

  @SubscribeMessage(C2S.STALL_BUY)
  async onStallBuy(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown): Promise<Ack<{ assetId: number; price: number }>> {
    const id = this.guard(socket);
    if (typeof id === 'string') return fail(id);
    const assetId = (body as { assetId?: unknown })?.assetId;
    if (!isId(assetId)) return fail('INVALID_PAYLOAD');
    return this.run(async () => {
      const res = await this.mechanics.stallBuy(id, assetId);
      await this.refreshPlayers(id);
      this.server.emit(S2C.STALL_UPDATED);
      this.server.to(assetRoom(assetId)).emit(S2C.ASSET_UPDATED, { assetId });
      return res;
    });
  }

  @SubscribeMessage(C2S.AUTH_REQUEST)
  async onAuthRequest(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown): Promise<Ack<{ verdict: 'genuine' | 'fake' }>> {
    const id = this.guard(socket);
    if (typeof id === 'string') return fail(id);
    const assetId = (body as { assetId?: unknown })?.assetId;
    if (!isId(assetId)) return fail('INVALID_PAYLOAD');
    return this.run(async () => {
      const res = await this.mechanics.authRequest(id, assetId);
      await this.refreshPlayers(id);
      this.server.to(assetRoom(assetId)).emit(S2C.ASSET_UPDATED, { assetId });
      // un falso smascherato in bacheca cambia valore: chi guarda la bacheca la ricarica
      if (res.verdict === 'fake') this.server.emit(S2C.MARKET_UPDATED);
      return res;
    });
  }

  @SubscribeMessage(C2S.LEGEND_REQUEST)
  async onLegendRequest(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown): Promise<Ack<{ until: number }>> {
    const id = this.guard(socket);
    if (typeof id === 'string') return fail(id);
    const assetId = (body as { assetId?: unknown })?.assetId;
    if (!isId(assetId)) return fail('INVALID_PAYLOAD');
    return this.run(async () => {
      const res = await this.mechanics.legendWear(id, assetId);
      await this.refreshPlayers(id);
      this.server.to(assetRoom(assetId)).emit(S2C.ASSET_UPDATED, { assetId });
      return res;
    });
  }

  @SubscribeMessage(C2S.DROP_STATE)
  onDropState(@ConnectedSocket() socket: GameSocket): Ack<DropState> {
    const id = this.guard(socket);
    if (typeof id === 'string') return fail(id);
    return { ok: true, data: this.drops.state() };
  }

  @SubscribeMessage(C2S.DROP_CLAIM)
  async onDropClaim(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown): Promise<Ack<{ assetId: number }>> {
    const id = this.guard(socket);
    if (typeof id === 'string') return fail(id);
    const dropId = (body as { dropId?: unknown })?.dropId;
    if (!isId(dropId)) return fail('INVALID_PAYLOAD');
    return this.run(async () => {
      const res = await this.drops.claim(id, dropId);
      await this.refreshPlayers(id);
      return res;
    });
  }

  // ------------------------------------------------------------------ classifica (M4)

  @SubscribeMessage(C2S.LEADERBOARD_GET)
  async onLeaderboard(@ConnectedSocket() socket: GameSocket): Promise<Ack<Leaderboard>> {
    const id = this.guard(socket);
    if (typeof id === 'string') return fail(id);
    return this.run(() => this.leaderboard.get(id));
  }

  /** Saldo, armadio e colore delle scarpe dopo un'azione: ai giocatori coinvolti, se connessi. */
  private async refreshPlayers(...ids: number[]): Promise<void> {
    for (const id of new Set(ids)) {
      const socket = this.sockets.get(id);
      if (!socket) continue;
      const state = await this.players.loadState(id);
      const update: InventoryUpdated = { coins: state.row.coins, wardrobeValue: state.wardrobeValue, inventory: state.inventory };
      socket.emit(S2C.INVENTORY_UPDATED, update);
      if (state.look) this.world.updateProfile(id, { shoesColor: state.shoesColor });
    }
  }

  /** Esegue un'azione: errori di gioco → ack con codice e messaggio in italiano; altri → INTERNAL nel log. */
  private async run<T>(fn: () => Promise<T>): Promise<Ack<T>> {
    try {
      return { ok: true, data: await fn() };
    } catch (err) {
      return this.failFrom(err);
    }
  }

  private socketRoom(playerId: number | null): string[] {
    const socket = playerId === null ? undefined : this.sockets.get(playerId);
    return socket ? [socket.id] : [];
  }

  private tick(dtSec: number): void {
    this.world.step(dtSec);
    const t = Date.now();
    for (const id of this.world.ids()) {
      const delta = this.world.deltaFor(id, t);
      if (delta) this.sockets.get(id)?.emit(S2C.WORLD_PLAYERS, delta);
    }
  }

  /** Sessione pronta e sotto il rate limit: restituisce il playerId, altrimenti il codice errore. */
  private guard(socket: GameSocket): number | string {
    const id = socket.data?.playerId;
    if (id === undefined) return 'DEVICE_INVALID';
    if (!socket.data.limiter.take()) return 'BUSY';
    return id;
  }

  private profileOf(state: PlayerState) {
    return { nickname: state.row.nickname, look: state.look!, shoesColor: state.shoesColor };
  }

  private stateInit(state: PlayerState, position: { x: number; y: number } | null): StateInit {
    return {
      serverTime: Date.now(),
      player: {
        id: state.row.id,
        nickname: state.row.nickname,
        avatar: state.look,
        coins: state.row.coins,
        shoesColor: state.shoesColor,
        legendReadyAt: state.row.legend_ready_ms === null ? null : Number(state.row.legend_ready_ms),
      },
      drop: this.drops.state(),
      inventory: state.inventory,
      wardrobeValue: state.wardrobeValue,
      position,
    };
  }

  private failFrom(err: unknown): Ack<never> {
    if (err instanceof SpError) return fail(err.code);
    this.logger.error(String(err));
    return fail('INTERNAL');
  }

  /**
   * Rifiuta la sessione: l'errore arriva al client, che chiude da sé; il server chiude comunque dopo
   * REJECT_GRACE_MS. Chiudere subito farebbe fallire con 400 il polling di socket.io già in volo.
   * Nel frattempo il socket non ha playerId: guard() scarta ogni richiesta.
   */
  private reject(socket: GameSocket, code: string): void {
    socket.emit(S2C.ERROR, { code, message: errorMessage(code) });
    setTimeout(() => socket.disconnect(true), REJECT_GRACE_MS).unref();
  }
}

function parseLook(body: unknown): AvatarLook | null {
  const b = body as Partial<AvatarLook> | null;
  if (!b) return null;
  const keys = ['skin', 'hair', 'hairColor', 'outfit'] as const;
  if (!keys.every((k) => Number.isInteger(b[k]))) return null;
  // body assente (client vecchio) = ragazzo; se c'è, deve essere un intero (lo valida la SP)
  if (b.body !== undefined && !Number.isInteger(b.body)) return null;
  return { body: b.body ?? 0, skin: b.skin!, hair: b.hair!, hairColor: b.hairColor!, outfit: b.outfit! };
}
