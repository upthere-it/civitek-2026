import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import {
  C2S,
  S2C,
  errorMessage,
  type Ack,
  type AvatarLook,
  type ClientToServerEvents,
  type MoveTo,
  type ServerToClientEvents,
  type StateInit,
  type WorldEmote,
} from '@sp/shared';
import type { Subscription } from 'rxjs';
import type { Socket } from 'socket.io';
import { ChainEventsService } from '../chain/chain-events.service';
import { GameConfigService } from '../config/game-config.service';
import { SpError } from '../db/sp-error';
import { isDeviceId } from './identity';
import { PlayerService, type PlayerState } from './player.service';
import { RateLimiter } from './rate-limit';
import { WorldService } from './world.service';

interface SocketData {
  deviceId: string;
  playerId?: number;
  limiter: RateLimiter;
}

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const fail = (code: string): Ack<never> => ({ ok: false, code, message: errorMessage(code) });

/**
 * Gateway socket.io: sessione dal device_id dell'handshake, presenza, emote. Il client manda intenzioni
 * (move.to, avatar.set, emote.send), mai stati. Ogni richiesta ha una risposta (ack) `Ack<T>`.
 */
@WebSocketGateway({ serveClient: false })
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  static readonly WORLD_TICK = 'world-tick';

  private readonly logger = new Logger(GameGateway.name);
  /** playerId → socket attivo (uno solo: una nuova scheda sostituisce la vecchia) */
  private readonly sockets = new Map<number, GameSocket>();
  private certified?: Subscription;

  constructor(
    private readonly players: PlayerService,
    private readonly world: WorldService,
    private readonly cfg: GameConfigService,
    private readonly chainEvents: ChainEventsService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const hz = this.cfg.config.world.tick_hz;
    const handle = setInterval(() => this.tick(1 / hz), 1000 / hz);
    this.scheduler.addInterval(GameGateway.WORLD_TICK, handle);
    this.certified = this.chainEvents.certified$.subscribe((batch) => {
      for (const n of batch) {
        const payload = { assetId: n.assetId, eventId: n.eventId, txHash: n.txHash, explorerUrl: n.explorerUrl };
        for (const id of new Set([n.fromId, n.toId])) if (id !== null) this.sockets.get(id)?.emit(S2C.ASSET_CERTIFIED, payload);
      }
    });
  }

  onModuleDestroy(): void {
    if (this.scheduler.doesExist('interval', GameGateway.WORLD_TICK)) this.scheduler.deleteInterval(GameGateway.WORLD_TICK);
    this.certified?.unsubscribe();
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
      }
      socket.emit(S2C.STATE_INIT, this.stateInit(state, deviceId, position));
    } catch (err) {
      this.logger.error(`handshake fallito: ${String(err)}`);
      this.reject(socket, err instanceof SpError ? err.code : 'INTERNAL');
    }
  }

  handleDisconnect(socket: GameSocket): void {
    const id = socket.data?.playerId;
    if (id !== undefined && this.sockets.get(id)?.id === socket.id) {
      this.sockets.delete(id);
      this.world.leave(id);
    }
  }

  @SubscribeMessage(C2S.AVATAR_SET)
  async onAvatarSet(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown): Promise<Ack<{ x: number; y: number }>> {
    const id = this.guard(socket);
    if (typeof id === 'string') return fail(id);
    const look = parseLook(body);
    if (!look) return fail('AVATAR_INVALID');
    try {
      await this.players.setAvatar(id, look);
      const state = await this.players.loadState(id);
      if (this.world.size >= this.cfg.config.world.max_players_per_room) return fail('WORLD_FULL');
      return { ok: true, data: this.world.join(id, this.profileOf(state)) };
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

  private stateInit(state: PlayerState, deviceId: string, position: { x: number; y: number } | null): StateInit {
    return {
      serverTime: Date.now(),
      player: {
        id: state.row.id,
        nickname: state.row.nickname,
        avatar: state.look,
        coins: state.row.coins,
        recoveryCode: this.players.displayCode(deviceId, state.row.recovery_hash),
        shoesColor: state.shoesColor,
      },
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

  private reject(socket: GameSocket, code: string): void {
    socket.emit(S2C.ERROR, { code, message: errorMessage(code) });
    socket.disconnect(true);
  }
}

function parseLook(body: unknown): AvatarLook | null {
  const b = body as Partial<AvatarLook> | null;
  if (!b) return null;
  const keys = ['skin', 'hair', 'hairColor', 'outfit'] as const;
  return keys.every((k) => Number.isInteger(b[k])) ? { skin: b.skin!, hair: b.hair!, hairColor: b.hairColor!, outfit: b.outfit! } : null;
}
