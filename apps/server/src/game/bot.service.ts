import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { listingPriceRange } from '@sp/shared';
import { REPO_ROOT } from '../config/env';
import { GameConfigService } from '../config/game-config.service';
import { DbService } from '../db/db.service';
import { SpError } from '../db/sp-error';
import { AssetsService } from './assets.service';
import { GameEventsService } from './game-events.service';
import { pickWeighted, startLoop, stopLoop } from './loop';
import { MarketService } from './market.service';
import { WorldService } from './world.service';

export type BotAction = 'buy' | 'sell' | 'idle';

/**
 * Bot di mercato (ECONOMY §4): danno liquidità quando ci sono pochi umani e si fanno da parte quando
 * aumentano. Comprano con i soldi della tesoreria (sp_bot_buy) e mettono in bacheca le loro scorte.
 */
@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
  static readonly LOOP = 'bots';

  private readonly logger = new Logger(BotService.name);
  private readonly styles: Map<number, string>;

  constructor(
    private readonly db: DbService,
    private readonly cfg: GameConfigService,
    private readonly assets: AssetsService,
    private readonly market: MarketService,
    private readonly world: WorldService,
    private readonly events: GameEventsService,
    private readonly scheduler: SchedulerRegistry,
  ) {
    const npcs = JSON.parse(readFileSync(join(REPO_ROOT, 'data', 'npcs.json'), 'utf8')) as {
      bots: { player_id: number; style: string }[];
    };
    this.styles = new Map(npcs.bots.map((b) => [b.player_id, b.style]));
  }

  onModuleInit(): void {
    startLoop(this.scheduler, BotService.LOOP, this.cfg.economy.bots.tick_sec * 1000, () => this.tick(), this.logger);
  }

  onModuleDestroy(): void {
    stopLoop(this.scheduler, BotService.LOOP);
  }

  /** Probabilità che un bot agisca a ogni giro, in funzione degli umani nel villaggio. */
  activity(humans: number): number {
    const b = this.cfg.economy.bots;
    if (humans <= b.full_activity_below_humans_online) return 1;
    if (humans >= b.min_activity_at_humans_online) return b.min_activity;
    const t = (humans - b.full_activity_below_humans_online) / (b.min_activity_at_humans_online - b.full_activity_below_humans_online);
    return 1 - t * (1 - b.min_activity);
  }

  /** Un giro per tutti i bot: scorte sempre, poi un'azione con probabilità activity. */
  async tick(rnd: () => number = Math.random): Promise<BotAction[]> {
    const act = this.activity(this.world.size);
    const out: BotAction[] = [];
    for (const botId of this.botIds()) {
      await this.restock(botId);
      out.push(rnd() < act ? await this.act(botId, rnd) : 'idle');
    }
    return out;
  }

  /** Un bot prova a comprare o a vendere (l'ordine dipende dallo stile); se non può, prova l'altra. */
  async act(botId: number, rnd: () => number = Math.random): Promise<BotAction> {
    const order: BotAction[] = rnd() < this.style(botId).buy_first ? ['buy', 'sell'] : ['sell', 'buy'];
    for (const a of order) {
      if (a === 'buy' ? await this.buy(botId) : await this.sell(botId)) return a;
    }
    return 'idle';
  }

  botIds(): number[] {
    const { bots_from } = this.cfg.economy.system_players;
    return Array.from({ length: this.cfg.economy.bots.count }, (_, i) => bots_from + i);
  }

  private style(botId: number) {
    const { styles } = this.cfg.economy.bots;
    return styles[this.styles.get(botId) ?? ''] ?? Object.values(styles)[0];
  }

  private async restock(botId: number): Promise<void> {
    const b = this.cfg.economy.bots;
    const [{ n }] = await this.db.select<{ n: number }>('SELECT COUNT(*) AS n FROM assets WHERE owner_id = ?', [botId]);
    const count = n === 0 ? b.start_stock : n < b.restock_below ? b.restock_count : 0;
    if (!count) return;
    const tiers = this.style(botId).restock_tiers;
    const pool = this.cfg.items.filter((i) => i.sources.includes('shop') && tiers.includes(i.tier));
    for (let i = 0; i < count; i++) {
      const item = pickWeighted(pool, () => 1, randomInt);
      if (item) await this.db.call('sp_bot_restock', [botId, item.id]);
    }
  }

  /** Mette in bacheca una sua scarpa a perceivedValue × sell_pct, se ha meno di bots.max_open_listings annunci. */
  private async sell(botId: number): Promise<boolean> {
    const rows = await this.db.select<{ id: number; listed: number }>(
      `SELECT a.id, (ml.id IS NOT NULL) AS listed
         FROM assets a LEFT JOIN market_listings ml ON ml.asset_id = a.id AND ml.status = 'OPEN'
        WHERE a.owner_id = ? AND a.is_fake = 0 ORDER BY a.id`,
      [botId],
    );
    const free = rows.filter((r) => !r.listed);
    if (!free.length || rows.length - free.length >= this.cfg.economy.bots.max_open_listings) return false;
    const pick = free[randomInt(free.length)];
    const value = (await this.assets.values([pick.id])).get(pick.id) ?? 0;
    const { min, max } = listingPriceRange(value, this.cfg.economy);
    const price = Math.min(max, Math.max(min, Math.round(value * this.cfg.economy.bots.sell_pct)));
    try {
      await this.market.createListing(botId, pick.id, price);
    } catch (err) {
      if (err instanceof SpError) return false;
      throw err;
    }
    this.events.emit({ type: 'market' });
    return true;
  }

  /** Compra l'annuncio umano più conveniente con prezzo ≤ perceivedValue × buy_pct. Mai falsi, mai da altri bot. */
  private async buy(botId: number): Promise<boolean> {
    const b = this.cfg.economy.bots;
    const [{ treasury, inv }] = await this.db.select<{ treasury: number; inv: number }>(
      `SELECT (SELECT coins FROM players WHERE id = ?) AS treasury,
              (SELECT COUNT(*) FROM assets WHERE owner_id = ?) AS inv`,
      [this.cfg.economy.system_players.treasury, botId],
    );
    if (treasury < this.cfg.economy.treasury_initial * b.min_treasury_pct_to_buy || inv >= b.max_inventory_per_bot) return false;

    const listings = await this.db.select<{ id: number; asset_id: number; price: number; seller_id: number }>(
      `SELECT ml.id, ml.asset_id, ml.price, ml.seller_id
         FROM market_listings ml
         JOIN players p ON p.id = ml.seller_id AND p.is_system = 0
         JOIN assets a ON a.id = ml.asset_id AND a.is_fake = 0 AND a.locked_until IS NULL
        WHERE ml.status = 'OPEN' AND ml.price <= ?
        ORDER BY ml.id DESC LIMIT 100`,
      [treasury],
    );
    if (!listings.length) return false;
    const values = await this.assets.values(listings.map((l) => l.asset_id));
    const deals = listings
      .map((l) => ({ ...l, max: Math.floor((values.get(l.asset_id) ?? 0) * b.buy_pct) }))
      .filter((l) => l.price <= l.max)
      .sort((x, y) => x.price / x.max - y.price / y.max);
    for (const deal of deals) {
      try {
        const [row] = await this.db.call<{ asset_id: number; seller_id: number }>('sp_bot_buy', [deal.id, botId, deal.max]);
        this.events.emit({ type: 'market' });
        this.events.emit({ type: 'players', ids: [row.seller_id] });
        this.events.emit({ type: 'asset', assetId: row.asset_id });
        return true;
      } catch (err) {
        // annuncio appena preso da altri, tesoreria sotto soglia, inventario pieno: si passa al prossimo
        if (!(err instanceof SpError)) throw err;
        if (err.code === 'TREASURY_LOW' || err.code === 'INVENTORY_FULL') return false;
      }
    }
    return false;
  }
}
