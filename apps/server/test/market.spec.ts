// M2 a livello DB: acquisto dal Negozio e ritiro di un annuncio, con gli invarianti sempre verdi.
import { SYS, cfg, coinsOf, eventsOf, listAsset, mint, newPlayer, openTestDb, spCode, violations } from './helpers/db';

const { pool, db } = openTestDb();
afterAll(() => db.onModuleDestroy());

const shopItem = cfg.items.find((i) => i.sources.includes('shop') && i.base_value <= cfg.player.start_coins)!;
const dropItem = cfg.items.find((i) => !i.sources.includes('shop'))!;

describe('sp_shop_buy', () => {
  it('monete alla tesoreria (SHOP) e MINT dal Negozio direttamente al giocatore', async () => {
    const p = await newPlayer(db);
    const treasuryBefore = await coinsOf(db, SYS.treasury);

    const [res] = await db.call<{ asset_id: number; price: number }>('sp_shop_buy', [p.id, shopItem.id]);

    expect(res.price).toBe(shopItem.base_value);
    expect(await coinsOf(db, p.id)).toBe(cfg.player.start_coins - shopItem.base_value);
    expect(await coinsOf(db, SYS.treasury)).toBe(treasuryBefore + shopItem.base_value);
    const ledger = await db.select('SELECT from_id, to_id, amount, reason FROM coin_ledger WHERE ref_id = ?', [res.asset_id]);
    expect(ledger).toEqual([{ from_id: p.id, to_id: SYS.treasury, amount: shopItem.base_value, reason: 'SHOP' }]);
    const [asset] = await db.select<{ owner_id: number; minted_by: number }>('SELECT owner_id, minted_by FROM assets WHERE id = ?', [
      res.asset_id,
    ]);
    expect(asset).toEqual({ owner_id: p.id, minted_by: SYS.shop });
    const chain = await eventsOf(db, res.asset_id);
    expect(chain.map((e) => [e.event, e.from_id, e.to_id, e.price, e.chain_status])).toEqual([
      ['MINT', null, p.id, shopItem.base_value, 'PENDING'],
    ]);
    expect(await violations(db)).toEqual([]);
  });

  it('errori: item non del Negozio, monete insufficienti, armadio pieno, account di sistema', async () => {
    const p = await newPlayer(db);
    expect(await spCode(db.call('sp_shop_buy', [p.id, dropItem.id]))).toBe('NOT_FOR_SALE');
    expect(await spCode(db.call('sp_shop_buy', [p.id, 'non-esiste']))).toBe('NOT_FOR_SALE');

    const expensive = cfg.items.filter((i) => i.sources.includes('shop')).sort((a, b) => b.base_value - a.base_value)[0];
    while ((await coinsOf(db, p.id)) >= expensive.base_value) await db.call('sp_shop_buy', [p.id, expensive.id]);
    expect(await spCode(db.call('sp_shop_buy', [p.id, expensive.id]))).toBe('NO_FUNDS');

    const full = await newPlayer(db);
    for (let i = 1; i < cfg.player.max_inventory; i++) await mint(pool, shopItem.id, full.id);
    expect(await spCode(db.call('sp_shop_buy', [full.id, shopItem.id]))).toBe('INVENTORY_FULL');

    expect(await spCode(db.call('sp_shop_buy', [SYS.bots_from, shopItem.id]))).toBe('PLAYER_NOT_FOUND');
    expect(await violations(db)).toEqual([]);
  });
});

describe('sp_listing_cancel', () => {
  it('solo il venditore ritira il suo annuncio OPEN; poi l’asset si può rimettere in bacheca', async () => {
    const seller = await newPlayer(db);
    const other = await newPlayer(db);
    const listingId = await listAsset(db, seller.id, seller.giftAssetId, 20);

    expect(await spCode(db.call('sp_listing_cancel', [other.id, listingId]))).toBe('NOT_OWNER');
    expect(await spCode(db.call('sp_listing_cancel', [seller.id, 999_999_999]))).toBe('LISTING_NOT_FOUND');

    const [res] = await db.call<{ listing_id: number; asset_id: number }>('sp_listing_cancel', [seller.id, listingId]);
    expect(res).toEqual({ listing_id: listingId, asset_id: seller.giftAssetId });
    const [l] = await db.select<{ status: string }>('SELECT status FROM market_listings WHERE id = ?', [listingId]);
    expect(l.status).toBe('CANCELLED');

    expect(await spCode(db.call('sp_listing_cancel', [seller.id, listingId]))).toBe('LISTING_CLOSED');
    expect(await spCode(db.call('sp_listing_buy', [listingId, other.id]))).toBe('LISTING_CLOSED');
    // l'annuncio annullato non blocca un nuovo annuncio dello stesso asset (I6 conta solo gli OPEN)
    await listAsset(db, seller.id, seller.giftAssetId, 25);
    expect(await violations(db)).toEqual([]);
  });
});
