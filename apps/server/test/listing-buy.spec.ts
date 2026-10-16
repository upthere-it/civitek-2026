// Accettazione M0: un acquisto da bacheca produce ledger, catena hash e certificazione mock corretti.
import { createHash } from 'node:crypto';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CertifiedNotice, ChainEventsService } from '../src/chain/chain-events.service';
import { notaryPayload } from '../src/chain/chain-notary';
import { ChainWorker } from '../src/chain/chain.worker';
import { MockNotary } from '../src/chain/mock-notary';
import { GameConfigService } from '../src/config/game-config.service';
import {
  SYS,
  cfg,
  coinsOf,
  eventsOf,
  listAsset,
  mint,
  newPlayer,
  openTestDb,
  perceivedOf,
  recomputeHash,
  spCode,
  violations,
} from './helpers/db';

const { pool, db } = openTestDb();
afterAll(() => db.onModuleDestroy());

const instantCfg = new GameConfigService(
  { ...cfg.config, chain: { ...cfg.chain, mock: { min_delay_ms: 0, max_delay_ms: 0 } } },
  cfg.items,
);

function mockWorker(events = new ChainEventsService()) {
  return new ChainWorker(db, new MockNotary(instantCfg.chain.mock), events, instantCfg, new SchedulerRegistry());
}

async function drain(worker: ChainWorker): Promise<number> {
  let total = 0;
  for (let n = await worker.tick(); n > 0; n = await worker.tick()) total += n;
  return total;
}

describe('sp_listing_buy — acquisto da bacheca', () => {
  it('scambio tra umani: ledger, proprietà, catena hash e certificazione mock', async () => {
    const seller = await newPlayer(db);
    const buyer = await newPlayer(db);
    const asset = seller.giftAssetId;
    const treasuryBefore = await coinsOf(db, SYS.treasury);

    const price = 30;
    const listingId = await listAsset(db, seller.id, asset, price);
    const [res] = await db.call<{ asset_id: number; seller_id: number; price: number; fee: number }>('sp_listing_buy', [
      listingId,
      buyer.id,
    ]);

    // commissione = max(market_fee_min, ceil(prezzo × market_fee_pct%)), pagata dal compratore in due righe
    const fee = Math.max(cfg.economy.market_fee_min, Math.ceil((price * cfg.economy.market_fee_pct) / 100));
    expect(res).toEqual({ asset_id: asset, seller_id: seller.id, price, fee });

    // monete
    const start = cfg.player.start_coins;
    expect(await coinsOf(db, buyer.id)).toBe(start - price);
    expect(await coinsOf(db, seller.id)).toBe(start + price - fee);
    expect(await coinsOf(db, SYS.treasury)).toBe(treasuryBefore + fee);

    // ledger
    const ledger = await db.select('SELECT from_id, to_id, amount, reason FROM coin_ledger WHERE ref_id = ? ORDER BY id', [
      asset,
    ]);
    expect(ledger).toEqual([
      { from_id: buyer.id, to_id: seller.id, amount: price - fee, reason: 'TRADE' },
      { from_id: buyer.id, to_id: SYS.treasury, amount: fee, reason: 'FEE' },
    ]);

    // proprietà e annuncio
    const [a] = await db.select<{ owner_id: number }>('SELECT owner_id FROM assets WHERE id = ?', [asset]);
    expect(a.owner_id).toBe(buyer.id);
    const [l] = await db.select('SELECT status, buyer_id FROM market_listings WHERE id = ?', [listingId]);
    expect(l).toEqual({ status: 'SOLD', buyer_id: buyer.id });

    // catena: regalo (MINT dal Negozio, prezzo 0) → TRANSFER, collegati e ricalcolabili fuori dal DB
    const chain = await eventsOf(db, asset);
    expect(chain.map((e) => [e.event, e.from_id, e.to_id, e.price])).toEqual([
      ['MINT', null, seller.id, 0],
      ['TRANSFER', seller.id, buyer.id, price],
    ]);
    expect(chain[0].prev_hash).toBeNull();
    expect(chain[1].prev_hash).toBe(chain[0].hash);
    for (const ev of chain) expect(recomputeHash(ev)).toBe(ev.hash);
    expect(chain.map((e) => e.chain_status)).toEqual(['PENDING', 'PENDING']);

    // certificazione: il worker svuota l'outbox, gli eventi diventano CONFIRMED e partono le notifiche
    const events = new ChainEventsService();
    const notices: CertifiedNotice[] = [];
    events.certified$.subscribe((batch) => notices.push(...batch));
    expect(await drain(mockWorker(events))).toBeGreaterThanOrEqual(2);

    const certified = await eventsOf(db, asset);
    expect(certified.map((e) => e.chain_status)).toEqual(['CONFIRMED', 'CONFIRMED']);
    for (const ev of certified) {
      // tx mock = sha256 del payload del suo batch (solo id evento e hash, nessun dato del giocatore)
      const batch = await db.select<{ id: number; hash: string }>(
        'SELECT id, hash FROM asset_events WHERE chain_batch = ? ORDER BY id',
        [ev.chain_batch],
      );
      const payload = notaryPayload(batch.map((r) => ({ eventId: r.id, hash: r.hash })));
      expect(ev.chain_tx).toBe(`mock-${createHash('sha256').update(payload).digest('hex')}`);
      expect(payload).not.toMatch(/nickname|device/);
    }
    expect(notices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assetId: asset, eventId: certified[1].id, fromId: seller.id, toId: buyer.id }),
      ]),
    );

    expect(await violations(db)).toEqual([]);
  });

  it('annuncio di un bot: incasso alla tesoreria (BOT_SELL), nessuna commissione', async () => {
    const bot = SYS.bots_from + 1;
    const buyer = await newPlayer(db);
    const asset = await mint(pool, 'nordline-20l', bot);
    const treasuryBefore = await coinsOf(db, SYS.treasury);

    const [res] = await db.call<{ fee: number }>('sp_listing_buy', [await listAsset(db, bot, asset, 40), buyer.id]);

    expect(res.fee).toBe(0);
    expect(await coinsOf(db, SYS.treasury)).toBe(treasuryBefore + 40);
    expect(await coinsOf(db, bot)).toBe(0);
    const ledger = await db.select('SELECT from_id, to_id, amount, reason FROM coin_ledger WHERE ref_id = ?', [asset]);
    expect(ledger).toEqual([{ from_id: buyer.id, to_id: SYS.treasury, amount: 40, reason: 'BOT_SELL' }]);
    const chain = await eventsOf(db, asset);
    expect(chain.map((e) => [e.event, e.chain_status])).toEqual([
      ['MINT', 'PENDING'], // MINT autentico: certificato anche se va a un bot
      ['TRANSFER', 'PENDING'],
    ]);
  });

  it('errori di gioco come codici SpError', async () => {
    const seller = await newPlayer(db);
    const buyer = await newPlayer(db);
    const asset = seller.giftAssetId;
    const perceived = await perceivedOf(db, asset);
    const maxPrice = perceived * cfg.economy.listing_max_multiplier;

    expect(await spCode(db.call('sp_listing_create', [buyer.id, asset, 10, perceived]))).toBe('NOT_OWNER');
    expect(await spCode(db.call('sp_listing_create', [seller.id, asset, cfg.economy.listing_min_price - 1, perceived]))).toBe(
      'PRICE_OUT_OF_RANGE',
    );
    expect(await spCode(db.call('sp_listing_create', [seller.id, asset, maxPrice + 1, perceived]))).toBe(
      'PRICE_OUT_OF_RANGE',
    );

    // prezzo massimo ammesso, oltre il saldo del compratore
    const listingId = await listAsset(db, seller.id, asset, maxPrice);
    expect(await spCode(db.call('sp_listing_buy', [listingId, seller.id]))).toBe('SELF_BUY');
    expect(await spCode(db.call('sp_listing_buy', [listingId, buyer.id]))).toBe('NO_FUNDS');
    expect(await spCode(db.call('sp_listing_buy', [999_999_999, buyer.id]))).toBe('LISTING_NOT_FOUND');

    // armadio pieno: il compratore ha già max_inventory scarpe
    const cheap = await newPlayer(db);
    const cheapListing = await listAsset(db, cheap.id, cheap.giftAssetId, 5);
    for (let i = 1; i < cfg.player.max_inventory; i++) await mint(pool, 'rampa-classica', buyer.id);
    expect(await spCode(db.call('sp_listing_buy', [cheapListing, buyer.id]))).toBe('INVENTORY_FULL');

    // annuncio già venduto
    const other = await newPlayer(db);
    await db.call('sp_listing_buy', [cheapListing, other.id]);
    expect(await spCode(db.call('sp_listing_buy', [cheapListing, other.id]))).toBe('LISTING_CLOSED');

    // l'asset passato di mano dopo l'annuncio: l'annuncio vecchio non si può più comprare
    const third = await newPlayer(db);
    const stale = await listAsset(db, third.id, third.giftAssetId, 5);
    // (simulato a mano: il prestito a MC Suola arriva in M3. Niente transazione esterna: la SP ne apre
    //  una sua, che farebbe il commit implicito di quella del test)
    await db.select('UPDATE assets SET owner_id = ? WHERE id = ?', [SYS.legend, third.giftAssetId]);
    try {
      expect(await spCode(db.call('sp_listing_buy', [stale, other.id]))).toBe('NOT_OWNER');
    } finally {
      await db.select('UPDATE assets SET owner_id = ? WHERE id = ?', [third.id, third.giftAssetId]);
    }

    expect(await violations(db)).toEqual([]);
  });

  it('acquisti simultanei dello stesso annuncio: ne passa uno solo', async () => {
    const seller = await newPlayer(db);
    const listingId = await listAsset(db, seller.id, seller.giftAssetId, 10);
    const buyers = await Promise.all(Array.from({ length: 8 }, () => newPlayer(db)));

    const results = await Promise.allSettled(buyers.map((b) => db.call('sp_listing_buy', [listingId, b.id])));

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const codes = results.flatMap((r) => (r.status === 'rejected' ? [(r.reason as { code: string }).code] : []));
    expect(codes).toEqual(Array(7).fill('LISTING_CLOSED'));
    expect(await violations(db)).toEqual([]);
  });
});
