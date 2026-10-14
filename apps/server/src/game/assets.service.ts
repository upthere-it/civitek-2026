import { Inject, Injectable } from '@nestjs/common';
import {
  assetViewFromChain,
  perceivedValue,
  stallPrice,
  type AssetEventType,
  type ChainStatus,
  type Passport,
  type StallOffer,
} from '@sp/shared';
import { CHAIN_NOTARY, type ChainNotary } from '../chain/chain-notary';
import { GameConfigService } from '../config/game-config.service';
import { DbService } from '../db/db.service';

interface AssetRow {
  id: number;
  public_id: string;
  item_id: string;
  serial: number;
  owner_id: number;
  minted_by: number;
  drop_id: number | null;
  drop_serial: number | null;
  is_fake: number;
  fake_revealed: number;
  auth_verified: number;
  legend_count: number;
  locked_until: string | null;
}

/** Letture sugli asset: valore percepito (perceivedValue di shared, unica implementazione) e passaporto. */
@Injectable()
export class AssetsService {
  constructor(
    private readonly db: DbService,
    private readonly cfg: GameConfigService,
    @Inject(CHAIN_NOTARY) private readonly notary: ChainNotary,
  ) {}

  /** Valore percepito di più asset con due query (asset + catene), per armadio e bacheca. */
  async values(assetIds: readonly number[]): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    if (!assetIds.length) return out;
    const assets = await this.db.select<AssetRow>('SELECT * FROM assets WHERE id IN (?)', [assetIds]);
    const links = await this.db.select<{ asset_id: number; event: AssetEventType; to_id: number; is_system: number }>(
      `SELECT ev.asset_id, ev.event, ev.to_id, p.is_system
         FROM asset_events ev JOIN players p ON p.id = ev.to_id
        WHERE ev.asset_id IN (?) ORDER BY ev.asset_id, ev.id`,
      [assetIds],
    );
    for (const a of assets) {
      const chain = links
        .filter((l) => l.asset_id === a.id)
        .map((l) => ({ event: l.event, toId: l.to_id, toIsSystem: l.is_system === 1 }));
      out.set(a.id, this.valueOf(a, chain));
    }
    return out;
  }

  /** Passaporto completo. Lo stato falso compare solo se smascherato: is_fake non esce mai in chiaro. */
  async passport(assetId: number): Promise<Passport | null> {
    const [a] = await this.db.select<AssetRow & { owner_name: string; drop_quantity: number | null; locked_until_ms: number | null }>(
      `SELECT a.*, o.nickname AS owner_name, d.quantity AS drop_quantity,
              ROUND(UNIX_TIMESTAMP(a.locked_until) * 1000) AS locked_until_ms
         FROM assets a
         JOIN players o ON o.id = a.owner_id
         LEFT JOIN drops d ON d.id = a.drop_id
        WHERE a.id = ?`,
      [assetId],
    );
    if (!a) return null;
    const events = await this.db.select<{
      id: number;
      event: AssetEventType;
      from_id: number | null;
      from_name: string | null;
      to_id: number;
      to_name: string;
      to_system: number;
      price: number;
      hash: string;
      prev_hash: string | null;
      at_ms: number;
      chain_status: ChainStatus;
      chain_tx: string | null;
    }>(
      `SELECT ev.id, ev.event, ev.from_id, f.nickname AS from_name, ev.to_id, t.nickname AS to_name,
              t.is_system AS to_system, ev.price, ev.hash, ev.prev_hash,
              ROUND(UNIX_TIMESTAMP(ev.created_at) * 1000) AS at_ms, ev.chain_status, ev.chain_tx
         FROM asset_events ev
         JOIN players t ON t.id = ev.to_id
         LEFT JOIN players f ON f.id = ev.from_id
        WHERE ev.asset_id = ? ORDER BY ev.id`,
      [assetId],
    );
    const [listing] = await this.db.select<{ id: number; price: number; seller_id: number }>(
      "SELECT id, price, seller_id FROM market_listings WHERE asset_id = ? AND status = 'OPEN'",
      [assetId],
    );
    const sys = this.cfg.economy.system_players;
    return {
      assetId: a.id,
      publicId: a.public_id,
      itemId: a.item_id,
      serial: a.serial,
      origin: a.minted_by === sys.shop ? 'shop' : a.minted_by === sys.treasury ? 'upthere' : a.minted_by === sys.stall ? 'stall' : 'other',
      dropSerial: a.drop_serial,
      dropQuantity: a.drop_quantity,
      perceivedValue: this.valueOf(
        a,
        events.map((e) => ({ event: e.event, toId: e.to_id, toIsSystem: e.to_system === 1 })),
      ),
      status: a.fake_revealed === 1 ? 'fake' : a.auth_verified === 1 ? 'authentic' : null,
      legendCount: a.legend_count,
      ownerId: a.owner_id,
      ownerName: a.owner_name,
      lockedUntil: a.locked_until_ms === null ? null : Number(a.locked_until_ms),
      listing: listing ? { listingId: listing.id, price: listing.price, sellerId: listing.seller_id } : null,
      stallPrice: a.owner_id === sys.stall ? stallPrice(this.cfg.item(a.item_id)?.base_value ?? 0, this.cfg.economy) : null,
      events: events.map((e) => ({
        id: e.id,
        event: e.event,
        fromId: e.from_id,
        fromName: e.from_name,
        toId: e.to_id,
        toName: e.to_name,
        price: e.price,
        toSystem: e.to_system === 1,
        hash: e.hash,
        prevHash: e.prev_hash,
        at: Number(e.at_ms),
        chainStatus: e.chain_status,
        txHash: e.chain_tx,
        explorerUrl: e.chain_tx ? this.notary.explorerUrl(e.chain_tx) || null : null,
      })),
    };
  }

  /** Scarpe sul banco di Tony Affari (owner = bancarella), con prezzo e valore percepito. */
  async stallOffers(): Promise<StallOffer[]> {
    const rows = await this.db.select<{ id: number; item_id: string; serial: number }>(
      'SELECT id, item_id, serial FROM assets WHERE owner_id = ? ORDER BY id',
      [this.cfg.economy.system_players.stall],
    );
    const values = await this.values(rows.map((r) => r.id));
    return rows.map((r) => ({
      assetId: r.id,
      itemId: r.item_id,
      serial: r.serial,
      price: stallPrice(this.cfg.item(r.item_id)?.base_value ?? 0, this.cfg.economy),
      perceivedValue: values.get(r.id) ?? 0,
    }));
  }

  private valueOf(a: AssetRow, chain: { event: AssetEventType; toId: number; toIsSystem: boolean }[]): number {
    const view = assetViewFromChain(
      { isFake: a.is_fake === 1, fakeRevealed: a.fake_revealed === 1, legendCount: a.legend_count, mintedBy: a.minted_by },
      chain,
      this.cfg.economy.system_players.treasury,
    );
    return perceivedValue(view, this.cfg.item(a.item_id)?.base_value ?? 0, this.cfg.valuation);
  }
}
