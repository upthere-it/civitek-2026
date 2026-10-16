// M3 a livello DB: Tony Affari, Dott.ssa Hash, MC Suola, drop della Banca e bot, con gli invarianti sempre verdi.
import { stallPrice } from '@sp/shared';
import { SYS, cfg, coinsOf, eventsOf, listAsset, newPlayer, openTestDb, perceivedOf, spCode, violations } from './helpers/db';

const { db } = openTestDb();
afterAll(() => db.onModuleDestroy());

const fakeItem = cfg.items.find((i) => i.fakeable && cfg.economy.stall.fake_tiers.includes(i.tier))!;
const dropItem = cfg.items.find((i) => i.sources.includes('drop') && i.base_value <= cfg.player.start_coins)!;
const shopItem = cfg.items.find((i) => i.sources.includes('shop'))!;
const BOT = SYS.bots_from;

const restock = async (itemId = fakeItem.id) => (await db.call<{ asset_id: number }>('sp_stall_restock', [itemId]))[0].asset_id;
/** Il prestito a MC Suola finisce subito (solo nei test): locked_until nel passato. */
const expireLoan = (assetId: number) => db.select('UPDATE assets SET locked_until = NOW(6) - INTERVAL 1 SECOND WHERE id = ?', [assetId]);
const resetCooldown = (playerId: number) => db.select('UPDATE players SET legend_ready_at = NULL WHERE id = ?', [playerId]);

describe('Tony Affari', () => {
  it('rifornimento: FAKE_MINT alla bancarella, non certificato; vendita al 50% con TRANSFER certificato', async () => {
    const fake = await restock();
    const [a] = await db.select<{ owner_id: number; minted_by: number; is_fake: number }>(
      'SELECT owner_id, minted_by, is_fake FROM assets WHERE id = ?',
      [fake],
    );
    expect(a).toEqual({ owner_id: SYS.stall, minted_by: SYS.stall, is_fake: 1 });

    const p = await newPlayer(db);
    const treasury = await coinsOf(db, SYS.treasury);
    const [res] = await db.call<{ price: number }>('sp_stall_buy', [p.id, fake]);
    const price = stallPrice(fakeItem.base_value, cfg.economy);
    expect(res.price).toBe(price);
    expect(await coinsOf(db, p.id)).toBe(cfg.player.start_coins - price);
    expect(await coinsOf(db, SYS.treasury)).toBe(treasury + price);

    const chain = await eventsOf(db, fake);
    expect(chain.map((e) => [e.event, e.from_id, e.to_id, e.price, e.chain_status])).toEqual([
      ['FAKE_MINT', null, SYS.stall, 0, 'NONE'],
      ['TRANSFER', SYS.stall, p.id, price, 'PENDING'],
    ]);
    // il falso non smascherato vale il 40% del base (origine non certificata)
    expect(await perceivedOf(db, fake)).toBe(Math.round(fakeItem.base_value * cfg.valuation.gap_multiplier));
    expect(await violations(db)).toEqual([]);
  });

  it('errori: scarpa non sul banco, item non falsificabile', async () => {
    const p = await newPlayer(db);
    expect(await spCode(db.call('sp_stall_buy', [p.id, p.giftAssetId]))).toBe('NOT_FOR_SALE');
    expect(await spCode(restock(shopItem.id))).toBe('NOT_FOR_SALE');
  });
});

describe('Dott.ssa Hash', () => {
  it('falso → smascherato (valore 2); autentica → verificata; una seconda volta non si paga', async () => {
    const p = await newPlayer(db);
    const fake = await restock();
    await db.call('sp_stall_buy', [p.id, fake]);
    const before = await coinsOf(db, p.id);

    const [v1] = await db.call<{ verdict: string }>('sp_auth_request', [p.id, fake]);
    expect(v1.verdict).toBe('fake');
    expect(await perceivedOf(db, fake)).toBe(cfg.valuation.fake_value_after_auth);
    const [v2] = await db.call<{ verdict: string }>('sp_auth_request', [p.id, p.giftAssetId]);
    expect(v2.verdict).toBe('genuine');
    expect(await coinsOf(db, p.id)).toBe(before - 2 * cfg.economy.auth_cost);

    const [flags] = await db.select<{ auth_verified: number }>('SELECT auth_verified FROM assets WHERE id = ?', [p.giftAssetId]);
    expect(flags.auth_verified).toBe(1);
    expect(await spCode(db.call('sp_auth_request', [p.id, p.giftAssetId]))).toBe('ALREADY_VERIFIED');
    expect(await spCode(db.call('sp_auth_request', [p.id, fake]))).toBe('ALREADY_VERIFIED');
    const other = await newPlayer(db);
    expect(await spCode(db.call('sp_auth_request', [other.id, p.giftAssetId]))).toBe('NOT_OWNER');
    expect(await violations(db)).toEqual([]);
  });
});

describe('MC Suola', () => {
  it('prestito: LEGEND_IN, scarpa bloccata ma sempre del giocatore; al ritorno LEGEND_OUT e +40%', async () => {
    const p = await newPlayer(db);
    const asset = p.giftAssetId;
    const valueBefore = await perceivedOf(db, asset);
    const [res] = await db.call<{ until_ms: number }>('sp_legend_wear', [p.id, asset]);
    expect(Number(res.until_ms)).toBeGreaterThan(Date.now());
    expect(await coinsOf(db, p.id)).toBe(cfg.player.start_coins - cfg.economy.legend.cost);

    // durante il prestito: proprietà invariata (I3 lo sa), niente vendita, niente seconda visita
    const [a] = await db.select<{ owner_id: number }>('SELECT owner_id FROM assets WHERE id = ?', [asset]);
    expect(a.owner_id).toBe(p.id);
    expect(await violations(db)).toEqual([]);
    expect(await spCode(listAsset(db, p.id, asset, 20))).toBe('ASSET_LOCKED');
    expect(await spCode(db.call('sp_legend_wear', [p.id, asset]))).toBe('ASSET_LOCKED');

    // prima della scadenza il ritorno non fa niente
    const [early] = await db.call<{ returned: number }>('sp_legend_return', [asset]);
    expect(early.returned).toBe(0);

    await expireLoan(asset);
    const [back] = await db.call<{ returned: number; owner_id: number }>('sp_legend_return', [asset]);
    expect(back).toMatchObject({ returned: 1, owner_id: p.id });
    const [again] = await db.call<{ returned: number }>('sp_legend_return', [asset]);
    expect(again.returned).toBe(0);

    const chain = await eventsOf(db, asset);
    expect(chain.slice(-2).map((e) => [e.event, e.from_id, e.to_id, e.chain_status])).toEqual([
      ['LEGEND_IN', p.id, SYS.legend, 'PENDING'],
      ['LEGEND_OUT', SYS.legend, p.id, 'PENDING'],
    ]);
    const item = cfg.item((await db.select<{ item_id: string }>('SELECT item_id FROM assets WHERE id = ?', [asset]))[0].item_id)!;
    expect(await perceivedOf(db, asset)).toBe(Math.round(item.base_value * (1 + cfg.valuation.legend_bonus_per_wear)));
    expect(valueBefore).toBe(item.base_value);
    expect(await violations(db)).toEqual([]);
  });

  it('cooldown per giocatore, massimo legend_max_counted volte, niente prestito di una scarpa in bacheca', async () => {
    const p = await newPlayer(db);
    const asset = p.giftAssetId;
    await db.call('sp_legend_wear', [p.id, asset]);
    await expireLoan(asset);
    await db.call('sp_legend_return', [asset]);
    expect(await spCode(db.call('sp_legend_wear', [p.id, asset]))).toBe('LEGEND_COOLDOWN');

    for (let i = 1; i < cfg.valuation.legend_max_counted; i++) {
      await resetCooldown(p.id);
      await db.call('sp_legend_wear', [p.id, asset]);
      await expireLoan(asset);
      await db.call('sp_legend_return', [asset]);
    }
    await resetCooldown(p.id);
    expect(await spCode(db.call('sp_legend_wear', [p.id, asset]))).toBe('LEGEND_MAXED');

    const q = await newPlayer(db);
    await listAsset(db, q.id, q.giftAssetId, 10);
    expect(await spCode(db.call('sp_legend_wear', [q.id, q.giftAssetId]))).toBe('ALREADY_LISTED');
    expect(await violations(db)).toEqual([]);
  });
});

describe('drop della Banca Upthere', () => {
  it('chi arriva prima: MINT dalla Banca, n. X di Y, uno a testa, poi esaurito', async () => {
    const [d] = await db.call<{ drop_id: number; closes_at_ms: number }>('sp_drop_open', [dropItem.id, 2, 60]);
    const a = await newPlayer(db);
    const b = await newPlayer(db);
    const c = await newPlayer(db);

    const [ra] = await db.call<{ asset_id: number; sold: number; quantity: number }>('sp_drop_claim', [d.drop_id, a.id]);
    expect(ra).toMatchObject({ sold: 1, quantity: 2, price: dropItem.base_value });
    expect(await spCode(db.call('sp_drop_claim', [d.drop_id, a.id]))).toBe('DROP_ALREADY_CLAIMED');
    await db.call('sp_drop_claim', [d.drop_id, b.id]);
    expect(await spCode(db.call('sp_drop_claim', [d.drop_id, c.id]))).toBe('DROP_SOLDOUT');

    const [asset] = await db.select<{ minted_by: number; drop_id: number; drop_serial: number }>(
      'SELECT minted_by, drop_id, drop_serial FROM assets WHERE id = ?',
      [ra.asset_id],
    );
    expect(asset).toEqual({ minted_by: SYS.treasury, drop_id: d.drop_id, drop_serial: 1 });
    expect(await coinsOf(db, a.id)).toBe(cfg.player.start_coins - dropItem.base_value);
    // Upthere primo proprietario: +25%
    expect(await perceivedOf(db, ra.asset_id)).toBe(Math.round(dropItem.base_value * (1 + cfg.valuation.upthere_mint_bonus)));
    expect(await violations(db)).toEqual([]);
  });

  it('drop chiuso e item che non è da drop', async () => {
    const [d] = await db.call<{ drop_id: number }>('sp_drop_open', [dropItem.id, 4, 1]);
    await db.select('UPDATE drops SET closes_at = NOW(6) - INTERVAL 1 SECOND WHERE id = ?', [d.drop_id]);
    const p = await newPlayer(db);
    expect(await spCode(db.call('sp_drop_claim', [d.drop_id, p.id]))).toBe('DROP_CLOSED');
    expect(await spCode(db.call('sp_drop_claim', [999_999_999, p.id]))).toBe('DROP_CLOSED');
    expect(await spCode(db.call('sp_drop_open', [shopItem.id, 4, 60]))).toBe('NOT_FOR_SALE');
  });
});

describe('bot', () => {
  it('scorta (MINT certificato, nessuna moneta) e acquisto da un umano con i soldi della tesoreria', async () => {
    const [r] = await db.call<{ asset_id: number }>('sp_bot_restock', [BOT, shopItem.id]);
    const [ev] = await eventsOf(db, r.asset_id);
    expect(ev).toMatchObject({ event: 'MINT', to_id: BOT, chain_status: 'PENDING' });

    const seller = await newPlayer(db);
    const value = await perceivedOf(db, seller.giftAssetId);
    const cheap = Math.floor(value * cfg.economy.bots.buy_pct);
    const listingId = await listAsset(db, seller.id, seller.giftAssetId, cheap);
    const treasury = await coinsOf(db, SYS.treasury);

    expect(await spCode(db.call('sp_bot_buy', [listingId, BOT, cheap - 1]))).toBe('PRICE_OUT_OF_RANGE');
    expect(await spCode(db.call('sp_bot_buy', [listingId, seller.id, cheap]))).toBe('PLAYER_NOT_FOUND');
    await db.call('sp_bot_buy', [listingId, BOT, cheap]);

    expect(await coinsOf(db, seller.id)).toBe(cfg.player.start_coins + cheap); // senza commissione
    expect(await coinsOf(db, SYS.treasury)).toBe(treasury - cheap);
    const ledger = await db.select('SELECT from_id, to_id, amount, reason FROM coin_ledger WHERE ref_id = ? AND reason = ?', [
      seller.giftAssetId,
      'BOT_BUY',
    ]);
    expect(ledger).toEqual([{ from_id: SYS.treasury, to_id: seller.id, amount: cheap, reason: 'BOT_BUY' }]);
    expect(await violations(db)).toEqual([]);
  });

  it('i bot non comprano dagli account di sistema', async () => {
    const [r] = await db.call<{ asset_id: number }>('sp_bot_restock', [BOT + 1, shopItem.id]);
    const listingId = await listAsset(db, BOT + 1, r.asset_id, 5);
    expect(await spCode(db.call('sp_bot_buy', [listingId, BOT, 100]))).toBe('NOT_FOR_SALE');
    expect(await spCode(db.call('sp_bot_restock', [SYS.shop, shopItem.id]))).toBe('PLAYER_NOT_FOUND');
    await db.call('sp_listing_cancel', [BOT + 1, listingId]);
  });
});
