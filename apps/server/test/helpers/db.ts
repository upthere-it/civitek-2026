import { createHash, randomBytes } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { assetViewFromChain, perceivedValue, type AssetEventType } from '@sp/shared';
import { GameConfigService } from '../../src/config/game-config.service';
import { DbService } from '../../src/db/db.service';
import { createDbPool } from '../../src/db/pool';

export const cfg = GameConfigService.fromRepo();
export const SYS = cfg.economy.system_players;

export interface TestDb {
  pool: Pool;
  db: DbService;
}

export function openTestDb(): TestDb {
  const pool = createDbPool();
  return { pool, db: new DbService(pool) };
}

export interface Violation {
  invariant: string;
  detail: string;
}

export const violations = (db: DbService) => db.call<Violation>('sp_economy_check');

let seq = 0;
const hex = (n: number) => randomBytes(n).toString('hex');

/** Nuovo giocatore tramite la SP reale: 100 monete (GRANT) e scarpa regalo (MINT). */
export async function newPlayer(db: DbService): Promise<{ id: number; giftAssetId: number }> {
  const nickname = `T${Date.now().toString(36)}${++seq}`;
  const [row] = await db.call<{ player_id: number; created: number; gift_asset_id: number }>(
    'sp_player_get_or_create',
    [hex(32), nickname, hex(32)],
  );
  return { id: row.player_id, giftAssetId: row.gift_asset_id };
}

/** Conia un asset con la procedura interna, dentro una transazione come farebbe una SP pubblica. */
export async function mint(
  pool: Pool,
  itemId: string,
  toId: number,
  opts: { mintedBy?: number; isFake?: boolean; price?: number } = {},
): Promise<number> {
  const conn = await pool.getConnection();
  try {
    await conn.query('START TRANSACTION');
    await conn.query('CALL _sp_mint(?, ?, ?, ?, ?, NULL, @asset_id)', [
      itemId,
      toId,
      opts.mintedBy ?? SYS.shop,
      opts.isFake ? 1 : 0,
      opts.price ?? 0,
    ]);
    const [rows] = await conn.query<RowDataPacket[]>('SELECT @asset_id AS id');
    await conn.query('COMMIT');
    return Number(rows[0].id);
  } catch (err) {
    await conn.query('ROLLBACK');
    throw err;
  } finally {
    conn.release();
  }
}

export interface EventRow {
  id: number;
  asset_id: number;
  event: AssetEventType;
  from_id: number | null;
  to_id: number;
  price: number;
  prev_hash: string | null;
  hash: string;
  created_at: string;
  chain_status: string;
  chain_batch: string | null;
  chain_tx: string | null;
  chain_attempts: number;
  chain_error: string | null;
}

export const eventsOf = (db: DbService, assetId: number) =>
  db.select<EventRow>('SELECT * FROM asset_events WHERE asset_id = ? ORDER BY id', [assetId]);

/** Lo stesso hash di _sp_append_event, ricalcolato in TypeScript dai dati salvati. */
export function recomputeHash(ev: EventRow): string {
  const parts = [ev.asset_id, ev.event, ev.from_id ?? '', ev.to_id, ev.price, ev.prev_hash ?? '', ev.created_at];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

/** Valore percepito come lo calcolerà il server: dati dell'asset + catena + perceivedValue() di shared. */
export async function perceivedOf(db: DbService, assetId: number): Promise<number> {
  const [a] = await db.select<{ item_id: string; is_fake: number; fake_revealed: number; legend_count: number; minted_by: number }>(
    'SELECT item_id, is_fake, fake_revealed, legend_count, minted_by FROM assets WHERE id = ?',
    [assetId],
  );
  const chain = await db.select<{ event: AssetEventType; to_id: number; is_system: number }>(
    `SELECT ev.event, ev.to_id, p.is_system
       FROM asset_events ev JOIN players p ON p.id = ev.to_id
      WHERE ev.asset_id = ? ORDER BY ev.id`,
    [assetId],
  );
  const view = assetViewFromChain(
    { isFake: !!a.is_fake, fakeRevealed: !!a.fake_revealed, legendCount: a.legend_count, mintedBy: a.minted_by },
    chain.map((c) => ({ event: c.event, toId: c.to_id, toIsSystem: !!c.is_system })),
    SYS.treasury,
  );
  return perceivedValue(view, cfg.item(a.item_id)!.base_value, cfg.valuation);
}

export async function listAsset(db: DbService, sellerId: number, assetId: number, price: number): Promise<number> {
  const [row] = await db.call<{ listing_id: number }>('sp_listing_create', [sellerId, assetId, price, await perceivedOf(db, assetId)]);
  return row.listing_id;
}

export async function coinsOf(db: DbService, playerId: number): Promise<number> {
  const [row] = await db.select<{ coins: number }>('SELECT coins FROM players WHERE id = ?', [playerId]);
  return row.coins;
}

/** Esegue `fn` in una transazione che viene sempre annullata e restituisce le violazioni viste dentro. */
export async function violationsAfterTampering(pool: Pool, fn: (conn: PoolConnection) => Promise<unknown>): Promise<Violation[]> {
  const conn = await pool.getConnection();
  try {
    await conn.query('START TRANSACTION');
    await fn(conn);
    const [res] = await conn.query<RowDataPacket[][]>('CALL sp_economy_check()');
    return res[0] as Violation[];
  } finally {
    await conn.query('ROLLBACK');
    conn.release();
  }
}

/** Rejection di una SP → codice SpError (o messaggio, se è un altro errore). */
export async function spCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return (err as { code?: string }).code ?? String(err);
  }
  return 'OK';
}
