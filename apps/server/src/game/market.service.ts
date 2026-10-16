import { Injectable } from '@nestjs/common';
import type { Listing, MarketPage, ShopEntry } from '@sp/shared';
import { GameConfigService } from '../config/game-config.service';
import { DbService } from '../db/db.service';
import { SpError } from '../db/sp-error';
import { AssetsService } from './assets.service';

/** Negozio e bacheca. Monete e proprietà cambiano solo nelle stored procedure; qui si leggono e si chiamano. */
@Injectable()
export class MarketService {
  constructor(
    private readonly db: DbService,
    private readonly cfg: GameConfigService,
    private readonly assets: AssetsService,
  ) {}

  /** Item in vendita al Negozio, al prezzo base (economy.shop_price = base_value). */
  shopList(): ShopEntry[] {
    return this.cfg.items.filter((i) => i.sources.includes('shop')).map((i) => ({ itemId: i.id, price: i.base_value }));
  }

  async shopBuy(playerId: number, itemId: string): Promise<{ assetId: number }> {
    const [row] = await this.db.call<{ asset_id: number }>('sp_shop_buy', [playerId, itemId]);
    return { assetId: row.asset_id };
  }

  /** Annunci aperti, dai più recenti, a pagine di economy.market_page_size (cursor = ultimo listingId visto). */
  async page(cursor?: number): Promise<MarketPage> {
    const size = this.cfg.economy.market_page_size;
    const rows = await this.db.select<{
      id: number;
      asset_id: number;
      item_id: string;
      serial: number;
      price: number;
      seller_id: number;
      seller_name: string;
    }>(
      `SELECT l.id, l.asset_id, a.item_id, a.serial, l.price, l.seller_id, p.nickname AS seller_name
         FROM market_listings l
         JOIN assets a ON a.id = l.asset_id
         JOIN players p ON p.id = l.seller_id
        WHERE l.status = 'OPEN' AND (? IS NULL OR l.id < ?)
        ORDER BY l.id DESC
        LIMIT ?`,
      [cursor ?? null, cursor ?? null, size + 1],
    );
    const pageRows = rows.slice(0, size);
    const values = await this.assets.values(pageRows.map((r) => r.asset_id));
    const listings: Listing[] = pageRows.map((r) => ({
      listingId: r.id,
      assetId: r.asset_id,
      itemId: r.item_id,
      serial: r.serial,
      price: r.price,
      perceivedValue: values.get(r.asset_id) ?? 0,
      sellerId: r.seller_id,
      sellerName: r.seller_name,
    }));
    return { listings, nextCursor: rows.length > size ? pageRows[pageRows.length - 1].id : null };
  }

  /** Il valore percepito lo calcola il server (shared) e lo passa alla SP, che ne ricava il prezzo massimo. */
  async createListing(playerId: number, assetId: number, price: number): Promise<{ listingId: number }> {
    const perceived = (await this.assets.values([assetId])).get(assetId);
    if (perceived === undefined) throw new SpError('NOT_OWNER');
    const [row] = await this.db.call<{ listing_id: number }>('sp_listing_create', [playerId, assetId, price, perceived]);
    return { listingId: row.listing_id };
  }

  async cancelListing(playerId: number, listingId: number): Promise<{ assetId: number }> {
    const [row] = await this.db.call<{ asset_id: number }>('sp_listing_cancel', [playerId, listingId]);
    return { assetId: row.asset_id };
  }

  async buyListing(buyerId: number, listingId: number): Promise<{ assetId: number; sellerId: number }> {
    const [row] = await this.db.call<{ asset_id: number; seller_id: number }>('sp_listing_buy', [listingId, buyerId]);
    return { assetId: row.asset_id, sellerId: row.seller_id };
  }
}
