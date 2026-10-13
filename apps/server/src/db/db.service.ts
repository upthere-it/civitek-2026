import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Pool, PoolConnection } from 'mysql2/promise';
import { isDeadlock, toSpError } from './sp-error';

export const DB_POOL = Symbol('DB_POOL');

const SP_NAME = /^sp_[a-z0-9_]+$/;

@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);

  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /**
   * Chiama una stored procedure pubblica e restituisce il suo primo result set.
   * Gli errori `SIGNAL '45000'` diventano SpError. Un deadlock si riprova una volta, poi è BUSY.
   */
  async call<T extends object = Record<string, unknown>>(sp: string, args: readonly unknown[] = []): Promise<T[]> {
    if (!SP_NAME.test(sp)) throw new Error(`procedura non ammessa: ${sp}`);
    const sql = `CALL ${sp}(${args.map(() => '?').join(', ')})`;
    for (let attempt = 1; ; attempt++) {
      try {
        const [result] = await this.pool.query(sql, args as unknown[]);
        return firstResultSet<T>(result);
      } catch (err) {
        if (attempt === 1 && isDeadlock(err)) {
          this.logger.warn(`deadlock su ${sp}, riprovo una volta`);
          continue;
        }
        throw toSpError(err);
      }
    }
  }

  /** Solo letture (viste del passaporto, bacheca, classifica). Monete e proprietà si toccano solo con call(). */
  async select<T extends object = Record<string, unknown>>(sql: string, args: readonly unknown[] = []): Promise<T[]> {
    const [rows] = await this.pool.query(sql, args as unknown[]);
    return rows as T[];
  }

  /** Allinea game_settings alla config. Restituisce quante chiavi sono cambiate rispetto al DB. */
  async replaceSettings(settings: readonly (readonly [string, string])[]): Promise<number> {
    return this.inTransaction(async (conn) => {
      const [rows] = await conn.query('SELECT name, value FROM game_settings FOR UPDATE');
      const current = new Map((rows as { name: string; value: string }[]).map((r) => [r.name, r.value]));
      const changed =
        settings.filter(([k, v]) => current.get(k) !== v).length +
        [...current.keys()].filter((k) => !settings.some(([n]) => n === k)).length;
      await conn.query('DELETE FROM game_settings');
      if (settings.length) await conn.query('INSERT INTO game_settings (name, value) VALUES ?', [settings]);
      return changed;
    });
  }

  private async inTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const out = await fn(conn);
      await conn.commit();
      return out;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

/** Il risultato di CALL è [rows, …, ResultSetHeader]; senza SELECT è solo il ResultSetHeader. */
function firstResultSet<T>(result: unknown): T[] {
  return Array.isArray(result) && Array.isArray(result[0]) ? (result[0] as T[]) : [];
}
