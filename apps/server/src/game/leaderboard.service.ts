import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { wardrobeValue, type Leaderboard, type LeaderboardRow } from '@sp/shared';
import { GameConfigService } from '../config/game-config.service';
import { DbService } from '../db/db.service';
import { AssetsService } from './assets.service';
import { GameEventsService } from './game-events.service';
import { startLoop, stopLoop } from './loop';
import { lookOf, type PlayerRow } from './player.service';
import { WorldService } from './world.service';

/**
 * Classifica live per valore armadio (GAME_DESIGN §13): solo giocatori veri con l'avatar pronto, niente bot
 * né account anonimizzati. Si ricalcola al massimo ogni leaderboard.cache_sec (con 100 giocatori che la aprono
 * insieme è una lettura sola) e, mentre c'è qualcuno nel villaggio, il loop la ricalcola con lo stesso ritmo e
 * la manda a tutti se è cambiata (`leaderboard.updated`): posizione nell'HUD e classifica aperta si muovono da sole.
 */
@Injectable()
export class LeaderboardService implements OnModuleInit, OnModuleDestroy {
  static readonly LOOP = 'leaderboard';

  private readonly logger = new Logger(LeaderboardService.name);
  private cache: { at: number; rows: LeaderboardRow[] } | null = null;
  private pending: Promise<LeaderboardRow[]> | null = null;
  /** Ultima classifica mandata: se non cambia, non si manda niente. */
  private lastSent = '';

  constructor(
    private readonly db: DbService,
    private readonly cfg: GameConfigService,
    private readonly assets: AssetsService,
    private readonly world: WorldService,
    private readonly events: GameEventsService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    startLoop(this.scheduler, LeaderboardService.LOOP, this.cfg.config.leaderboard.cache_sec * 1000, () => this.tick(), this.logger);
  }

  onModuleDestroy(): void {
    stopLoop(this.scheduler, LeaderboardService.LOOP);
  }

  async get(playerId: number, now = Date.now()): Promise<Leaderboard> {
    return this.boardFor(await this.ranking(now), playerId);
  }

  /** Top uguale per tutti, più la riga di chi guarda (anche fuori dalla top). */
  boardFor(rows: LeaderboardRow[], playerId: number): Leaderboard {
    return { top: rows.slice(0, this.cfg.config.leaderboard.size), me: rows.find((r) => r.playerId === playerId) ?? null };
  }

  /** Un giro: con qualcuno nel villaggio ricalcola e, se è cambiata, la manda (il gateway la personalizza). */
  async tick(now = Date.now()): Promise<boolean> {
    if (this.world.size === 0) return false;
    this.invalidate();
    const rows = await this.ranking(now);
    const key = JSON.stringify(rows);
    if (key === this.lastSent) return false;
    this.lastSent = key;
    this.events.emit({ type: 'leaderboard', rows });
    return true;
  }

  /** Dimentica la cache (i test cambiano i saldi e rileggono subito). */
  invalidate(): void {
    this.cache = null;
  }

  private async ranking(now: number): Promise<LeaderboardRow[]> {
    if (this.cache && now - this.cache.at < this.cfg.config.leaderboard.cache_sec * 1000) return this.cache.rows;
    this.pending ??= this.compute().finally(() => (this.pending = null));
    const rows = await this.pending;
    this.cache = { at: now, rows };
    return rows;
  }

  private async compute(): Promise<LeaderboardRow[]> {
    const players = await this.db.select<PlayerRow>(
      `SELECT id, nickname, coins, avatar_body, avatar_skin, avatar_hair, avatar_hair_color, avatar_outfit,
              NULL AS recovery_hash, NULL AS legend_ready_ms
         FROM players
        WHERE is_system = 0 AND anonymized_at IS NULL AND avatar_skin IS NOT NULL`,
    );
    if (!players.length) return [];
    const owned = await this.db.select<{ id: number; owner_id: number; item_id: string }>(
      `SELECT a.id, a.owner_id, a.item_id
         FROM assets a JOIN players p ON p.id = a.owner_id
        WHERE p.is_system = 0 AND p.anonymized_at IS NULL AND p.avatar_skin IS NOT NULL`,
    );
    const values = await this.assets.values(owned.map((a) => a.id));
    const byOwner = new Map<number, { value: number; itemId: string }[]>();
    for (const a of owned) {
      const list = byOwner.get(a.owner_id) ?? [];
      list.push({ value: values.get(a.id) ?? 0, itemId: a.item_id });
      byOwner.set(a.owner_id, list);
    }

    const rows = players.map((p) => {
      const shoes = byOwner.get(p.id) ?? [];
      let best: { value: number; itemId: string } | null = null;
      for (const s of shoes) if (!best || s.value > best.value) best = s;
      return {
        rank: 0,
        playerId: p.id,
        nickname: p.nickname,
        look: lookOf(p)!,
        shoesColor: best ? (this.cfg.item(best.itemId)?.palette.upper ?? null) : null,
        value: wardrobeValue(p.coins, shoes.map((s) => s.value)),
      };
    });
    // a pari valore è davanti chi è arrivato prima
    rows.sort((a, b) => b.value - a.value || a.playerId - b.playerId);
    rows.forEach((r, i) => (r.rank = i + 1));
    return rows;
  }
}
