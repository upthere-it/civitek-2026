// Invarianti dell'economia (ECONOMY §6). Test obbligatorio: deve restare verde (CLAUDE.md, regola 2).
import type { RowDataPacket } from 'mysql2/promise';
import {
  SYS,
  coinsOf,
  listAsset,
  mint,
  newPlayer,
  openTestDb,
  spCode,
  violations,
  violationsAfterTampering,
} from './helpers/db';

const { pool, db } = openTestDb();
afterAll(() => db.onModuleDestroy());

const kinds = (v: { invariant: string }[]) => [...new Set(v.map((x) => x.invariant))].sort();

describe('economy invariants I1–I6', () => {
  let a: { id: number; giftAssetId: number };
  let b: { id: number; giftAssetId: number };

  beforeAll(async () => {
    // Uno scenario misto: nuovi giocatori, scambi tra umani, acquisto da un bot, falsi di Tony.
    a = await newPlayer(db);
    b = await newPlayer(db);
    const c = await newPlayer(db);

    await db.call('sp_listing_buy', [await listAsset(db, a.id, a.giftAssetId, 20), b.id]);
    await db.call('sp_listing_buy', [await listAsset(db, b.id, b.giftAssetId, 15), c.id]);
    await db.call('sp_listing_buy', [await listAsset(db, b.id, a.giftAssetId, 25), c.id]);

    const botAsset = await mint(pool, 'kaze-113', SYS.bots_from);
    await db.call('sp_listing_buy', [await listAsset(db, SYS.bots_from, botAsset, 35), a.id]);

    await mint(pool, 'shiro-66', SYS.stall, { mintedBy: SYS.stall, isFake: true });
  });

  it('su uno scenario reale sp_economy_check non trova violazioni', async () => {
    expect(await violations(db)).toEqual([]);
  });

  it('I1 — circolante = emesso; vede monete create fuori dal ledger, anche per singolo giocatore', async () => {
    const [{ circolante, emesso }] = await db.select<{ circolante: number; emesso: number }>(
      `SELECT (SELECT SUM(coins) FROM players) AS circolante,
              (SELECT SUM(amount) FROM coin_ledger WHERE from_id IS NULL) AS emesso`,
    );
    expect(circolante).toBe(emesso);

    const created = await violationsAfterTampering(pool, (conn) =>
      conn.query('UPDATE players SET coins = coins + 10 WHERE id = ?', [a.id]),
    );
    expect(kinds(created)).toEqual(['I1']);
    expect(created.map((v) => v.detail).join('\n')).toMatch(new RegExp(`giocatore ${a.id}`));

    // Spostamento a somma zero fuori dal ledger: il totale torna, il controllo per giocatore no
    const moved = await violationsAfterTampering(pool, async (conn) => {
      await conn.query('UPDATE players SET coins = coins - 5 WHERE id = ?', [a.id]);
      await conn.query('UPDATE players SET coins = coins + 5 WHERE id = ?', [b.id]);
    });
    expect(moved).toHaveLength(2);
    expect(kinds(moved)).toEqual(['I1']);
  });

  it('I1 — emissione solo come GRANT, mai monete verso o da giocatori inesistenti', async () => {
    const conn = await pool.getConnection();
    try {
      await conn.query('START TRANSACTION');
      await expect(conn.query("CALL _sp_move_coins(NULL, ?, 50, 'TRADE', NULL)", [a.id])).rejects.toMatchObject({
        sqlMessage: 'LEDGER_INVALID',
      });
      await expect(conn.query("CALL _sp_move_coins(?, 999999, 5, 'TRADE', NULL)", [a.id])).rejects.toMatchObject({
        sqlMessage: 'PLAYER_NOT_FOUND',
      });
    } finally {
      await conn.query('ROLLBACK');
      conn.release();
    }
  });

  it('I2 — nessun saldo negativo: il CHECK blocca sia l’UPDATE diretto sia un movimento scoperto', async () => {
    await expect(db.select('UPDATE players SET coins = -1 WHERE id = ?', [b.id])).rejects.toMatchObject({ errno: 3819 });

    const conn = await pool.getConnection();
    try {
      await conn.query('START TRANSACTION');
      const coins = await coinsOf(db, b.id);
      await expect(
        conn.query("CALL _sp_move_coins(?, ?, ?, 'TRADE', NULL)", [b.id, a.id, coins + 1]),
      ).rejects.toMatchObject({ errno: 3819 });
    } finally {
      await conn.query('ROLLBACK');
      conn.release();
    }
    const [{ n }] = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM players WHERE coins < 0');
    expect(n).toBe(0);
  });

  it('I3 — il proprietario è il destinatario dell’ultimo evento', async () => {
    const found = await violationsAfterTampering(pool, (conn) =>
      conn.query('UPDATE assets SET owner_id = ? WHERE id = ?', [a.id, b.giftAssetId]),
    );
    expect(kinds(found)).toEqual(['I3']);
  });

  it('I4 — la catena hash si rompe se si cambia un anello', async () => {
    const [ev] = await db.select<{ id: number }>(
      "SELECT id FROM asset_events WHERE asset_id = ? AND event = 'TRANSFER' ORDER BY id LIMIT 1",
      [a.giftAssetId],
    );
    const priceChanged = await violationsAfterTampering(pool, (conn) =>
      conn.query('UPDATE asset_events SET price = price + 1 WHERE id = ?', [ev.id]),
    );
    expect(priceChanged).toEqual([{ invariant: 'I4', detail: `evento ${ev.id}: hash non corrisponde` }]);

    // Anello riscritto con un hash "valido" per i suoi dati: si rompe il collegamento con l'anello dopo
    const rewritten = await violationsAfterTampering(pool, (conn) =>
      conn.query(
        `UPDATE asset_events
            SET price = price + 1,
                hash = SHA2(CONCAT_WS('|', asset_id, event, IFNULL(from_id, ''), to_id, price, IFNULL(prev_hash, ''),
                                      DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s.%f')), 256)
          WHERE id = ?`,
        [ev.id],
      ),
    );
    expect(kinds(rewritten)).toEqual(['I4']);
    expect(rewritten[0].detail).toMatch(/prev_hash non corrisponde/);
  });

  it('I5 — ogni evento con un umano è in coda per la certificazione; i falsi di Tony no', async () => {
    const [fake] = await db.select<RowDataPacket>(
      "SELECT chain_status FROM asset_events WHERE event = 'FAKE_MINT' ORDER BY id DESC LIMIT 1",
    );
    expect(fake.chain_status).toBe('NONE');

    const found = await violationsAfterTampering(pool, (conn) =>
      conn.query("UPDATE asset_events SET chain_status = 'NONE' WHERE asset_id = ? AND event = 'TRANSFER'", [
        a.giftAssetId,
      ]),
    );
    expect(kinds(found)).toEqual(['I5']);
  });

  it('I6 — al massimo un annuncio OPEN per asset', async () => {
    const d = await newPlayer(db);
    await listAsset(db, d.id, d.giftAssetId, 10);
    expect(await spCode(listAsset(db, d.id, d.giftAssetId, 12))).toBe('ALREADY_LISTED');
    await expect(
      db.select('INSERT INTO market_listings (asset_id, seller_id, price) VALUES (?, ?, 11)', [d.giftAssetId, d.id]),
    ).rejects.toMatchObject({ errno: 1062 });
  });

  it('registrazioni simultanee (tutta la sala che scansiona il QR): nessun deadlock', async () => {
    const results = await Promise.allSettled(Array.from({ length: 40 }, () => newPlayer(db)));
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    expect(await violations(db)).toEqual([]);
  });

  it('restano valide dopo scambi concorrenti incrociati (ordine dei lock: niente deadlock)', async () => {
    for (let round = 0; round < 3; round++) {
      const players = await Promise.all(Array.from({ length: 12 }, () => newPlayer(db)));
      // ogni giocatore mette in vendita il regalo; poi tutti comprano dal vicino nello stesso momento
      const listings = await Promise.all(players.map((p) => listAsset(db, p.id, p.giftAssetId, 10)));
      const results = await Promise.allSettled(
        players.map((p, i) => db.call('sp_listing_buy', [listings[(i + 1) % players.length], p.id])),
      );
      expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    }
    expect(await violations(db)).toEqual([]);
  });
});
