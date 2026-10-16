import { randomInt } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { DropInfo, DropState } from '@sp/shared';
import { GameConfigService } from '../config/game-config.service';
import { DbService } from '../db/db.service';
import { GameEventsService } from './game-events.service';
import { pickWeighted, startLoop, stopLoop } from './loop';

/** Il loop controlla spesso se è ora di aprire o chiudere: il drop dura pochi secondi, l'orologio è condiviso. */
const DROP_CHECK_EVERY_MS = 1000;

/**
 * Drop della Banca Upthere (GAME_DESIGN §11): ogni drops.interval_sec su un orologio di mondo uguale per tutti
 * (multipli di interval_sec dall'epoch), item pesato con drop_weight tra i tier di drops.pool_tiers.
 */
@Injectable()
export class DropService implements OnModuleInit, OnModuleDestroy {
  static readonly LOOP = 'drops';

  private readonly logger = new Logger(DropService.name);
  private current: DropInfo | null = null;
  private nextAt = 0;

  constructor(
    private readonly db: DbService,
    private readonly cfg: GameConfigService,
    private readonly events: GameEventsService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    this.nextAt = this.nextSlot(Date.now());
    startLoop(this.scheduler, DropService.LOOP, DROP_CHECK_EVERY_MS, () => this.tick(), this.logger);
  }

  onModuleDestroy(): void {
    stopLoop(this.scheduler, DropService.LOOP);
  }

  state(): DropState {
    return { current: this.current, nextAt: this.nextAt };
  }

  /** Un giro: chiude il drop scaduto o esaurito, apre il prossimo se è l'ora. */
  async tick(now = Date.now()): Promise<void> {
    if (this.current && (now >= this.current.closesAt || this.current.sold >= this.current.quantity)) this.close();
    if (!this.current && now >= this.nextAt) await this.open(now);
  }

  /** Apre subito un drop (lo usa il loop; i test lo chiamano direttamente). */
  async open(now = Date.now(), itemId?: string): Promise<DropInfo> {
    const { quantity, window_sec, pool_tiers } = this.cfg.config.drops;
    const item = itemId
      ? this.cfg.item(itemId)
      : pickWeighted(
          this.cfg.items.filter((i) => i.sources.includes('drop') && pool_tiers.includes(i.tier)),
          (i) => i.drop_weight,
          randomInt,
        );
    if (!item) throw new Error('nessun item per il drop');
    const [row] = await this.db.call<{ drop_id: number; closes_at_ms: number }>('sp_drop_open', [item.id, quantity, window_sec]);
    this.current = {
      dropId: row.drop_id,
      itemId: item.id,
      quantity,
      sold: 0,
      price: item.base_value,
      closesAt: Number(row.closes_at_ms),
    };
    this.nextAt = this.nextSlot(now);
    this.logger.log(`drop ${row.drop_id}: ${quantity} × ${item.id}`);
    this.events.emit({ type: 'drop.announce', drop: this.current });
    return this.current;
  }

  async claim(playerId: number, dropId: number): Promise<{ assetId: number }> {
    const [row] = await this.db.call<{ asset_id: number; sold: number; quantity: number }>('sp_drop_claim', [dropId, playerId]);
    if (this.current?.dropId === dropId) {
      this.current = { ...this.current, sold: Math.max(this.current.sold, Number(row.sold)) };
      this.events.emit({ type: 'drop.update', dropId, sold: this.current.sold });
      if (this.current.sold >= this.current.quantity) this.close();
    }
    return { assetId: row.asset_id };
  }

  private close(): void {
    if (!this.current) return;
    const { dropId } = this.current;
    this.current = null;
    this.events.emit({ type: 'drop.closed', dropId, nextAt: this.nextAt });
  }

  /** Prossimo multiplo di interval_sec dopo `now`: lo stesso istante per tutti i giocatori. */
  private nextSlot(now: number): number {
    const step = this.cfg.config.drops.interval_sec * 1000;
    return (Math.floor(now / step) + 1) * step;
  }
}
