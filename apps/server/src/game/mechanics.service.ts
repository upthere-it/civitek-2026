import { randomInt } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { StallOffer } from '@sp/shared';
import { GameConfigService } from '../config/game-config.service';
import { DbService } from '../db/db.service';
import { AssetsService } from './assets.service';
import { GameEventsService } from './game-events.service';
import { pickWeighted, startLoop, stopLoop } from './loop';

/** Il loop che restituisce le scarpe da MC Suola gira spesso: il prestito dura pochi secondi. */
const LEGEND_RETURN_EVERY_MS = 1000;

/**
 * Le meccaniche del messaggio (GAME_DESIGN §9–10): Tony Affari e i falsi, la Dott.ssa Hash, MC Suola.
 * Monete e proprietà passano solo dalle SP; qui ci sono i loop (rifornimento, ritorno dal prestito).
 */
@Injectable()
export class MechanicsService implements OnModuleInit, OnModuleDestroy {
  static readonly STALL_LOOP = 'stall-restock';
  static readonly LEGEND_LOOP = 'legend-return';

  private readonly logger = new Logger(MechanicsService.name);

  constructor(
    private readonly db: DbService,
    private readonly cfg: GameConfigService,
    private readonly assets: AssetsService,
    private readonly events: GameEventsService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    startLoop(this.scheduler, MechanicsService.STALL_LOOP, this.cfg.economy.stall.restock_sec * 1000, () => this.restockStall(), this.logger);
    startLoop(this.scheduler, MechanicsService.LEGEND_LOOP, LEGEND_RETURN_EVERY_MS, () => this.returnFromLegend(), this.logger);
  }

  onModuleDestroy(): void {
    stopLoop(this.scheduler, MechanicsService.STALL_LOOP);
    stopLoop(this.scheduler, MechanicsService.LEGEND_LOOP);
  }

  // ------------------------------------------------------------------ Tony Affari

  stallList(): Promise<StallOffer[]> {
    return this.assets.stallOffers();
  }

  async stallBuy(playerId: number, assetId: number): Promise<{ assetId: number; price: number }> {
    const [row] = await this.db.call<{ asset_id: number; price: number }>('sp_stall_buy', [playerId, assetId]);
    return { assetId: row.asset_id, price: row.price };
  }

  /** Riporta il banco a max_fakes_on_sale falsi, scelti tra gli item falsificabili dei tier di config. */
  async restockStall(): Promise<number> {
    const { max_fakes_on_sale, fake_tiers } = this.cfg.economy.stall;
    const [{ n }] = await this.db.select<{ n: number }>('SELECT COUNT(*) AS n FROM assets WHERE owner_id = ?', [
      this.cfg.economy.system_players.stall,
    ]);
    const pool = this.cfg.items.filter((i) => i.fakeable && fake_tiers.includes(i.tier));
    let added = 0;
    for (let i = n; i < max_fakes_on_sale; i++) {
      const item = pickWeighted(pool, () => 1, randomInt);
      if (!item) break;
      await this.db.call('sp_stall_restock', [item.id]);
      added++;
    }
    if (added) this.events.emit({ type: 'stall' });
    return added;
  }

  // ------------------------------------------------------------------ Dott.ssa Hash

  async authRequest(playerId: number, assetId: number): Promise<{ verdict: 'genuine' | 'fake' }> {
    const [row] = await this.db.call<{ verdict: 'genuine' | 'fake' }>('sp_auth_request', [playerId, assetId]);
    return { verdict: row.verdict };
  }

  // ------------------------------------------------------------------ MC Suola

  async legendWear(playerId: number, assetId: number): Promise<{ until: number }> {
    const [row] = await this.db.call<{ until_ms: number }>('sp_legend_wear', [playerId, assetId]);
    return { until: Number(row.until_ms) };
  }

  /** Restituisce le scarpe a prestito finito (anche quelle rimaste in sospeso da un riavvio del server). */
  async returnFromLegend(): Promise<number> {
    const due = await this.db.select<{ id: number }>(
      'SELECT id FROM assets WHERE locked_until IS NOT NULL AND locked_until <= NOW(6) ORDER BY id',
    );
    let returned = 0;
    for (const { id } of due) {
      const [row] = await this.db.call<{ owner_id: number; returned: number }>('sp_legend_return', [id]);
      if (row?.returned !== 1) continue;
      returned++;
      this.events.emit({ type: 'legend.returned', assetId: id, ownerId: row.owner_id });
    }
    return returned;
  }
}
