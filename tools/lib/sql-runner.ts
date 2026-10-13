import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import mysql from 'mysql2/promise';
import { assertResettable, type DbParams } from './env';

/**
 * Divide uno script SQL in statement, rispettando `DELIMITER` come il client `mysql`: così gli stessi
 * file girano sia da qui sia a mano in produzione (`mysql < sql/003_procedures.sql`).
 * Tiene conto di stringhe, identificatori quotati e commenti.
 */
export function splitSqlScript(text: string): string[] {
  const out: string[] = [];
  const n = text.length;
  let delimiter = ';';
  let start = 0;
  let i = 0;
  let quote: string | null = null;

  const flush = (end: number, terminated: boolean) => {
    const stmt = text.slice(start, end).trim();
    if (isBlank(stmt)) return;
    if (!terminated) throw new Error(`Statement senza delimitatore: ${stmt.slice(0, 80)}…`);
    out.push(stmt);
  };

  while (i < n) {
    const c = text[i];
    if (quote) {
      if (c === '\\' && quote !== '`') { i += 2; continue; }
      if (c === quote) {
        if (text[i + 1] === quote) { i += 2; continue; }
        quote = null;
      }
      i++;
      continue;
    }
    if (i === 0 || text[i - 1] === '\n') {
      const eol = text.indexOf('\n', i);
      const lineEnd = eol === -1 ? n : eol;
      const m = /^\s*DELIMITER\s+(\S+)\s*$/i.exec(text.slice(i, lineEnd));
      if (m) {
        flush(i, false);
        delimiter = m[1];
        i = start = Math.min(n, lineEnd + 1);
        continue;
      }
    }
    if ((c === '-' && text[i + 1] === '-' && (i + 2 >= n || /\s/.test(text[i + 2]))) || c === '#') {
      const eol = text.indexOf('\n', i);
      i = eol === -1 ? n : eol;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; i++; continue; }
    if (text.startsWith(delimiter, i)) {
      flush(i, true);
      i = start = i + delimiter.length;
      continue;
    }
    i++;
  }
  flush(n, false);
  return out;
}

function isBlank(sql: string): boolean {
  return sql.replace(/--[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\//g, '').trim() === '';
}

export type Conn = mysql.Connection;

export async function connect(p: DbParams, withDatabase = true): Promise<Conn> {
  return mysql.createConnection({
    host: p.host,
    port: p.port,
    user: p.user,
    password: p.password,
    database: withDatabase ? p.database : undefined,
    charset: 'utf8mb4',
    dateStrings: true,
  });
}

/** Si connette al database, creandolo se manca (charset/collation richiesti dallo schema). */
export async function connectOrCreate(p: DbParams): Promise<Conn> {
  const conn = await connect(p, false);
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS ${mysql.escapeId(p.database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
  );
  await conn.query(`USE ${mysql.escapeId(p.database)}`);
  return conn;
}

export async function runScript(conn: Conn, sql: string): Promise<number> {
  const statements = splitSqlScript(sql);
  for (const stmt of statements) await conn.query(stmt);
  return statements.length;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Applica in ordine i file `NNN_*.sql` non ancora registrati in `schema_migrations`. */
export async function migrate(conn: Conn, sqlDir: string, log: (msg: string) => void = () => {}): Promise<string[]> {
  await conn.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename   VARCHAR(191) NOT NULL PRIMARY KEY,
       checksum   CHAR(64) NOT NULL,
       applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  );
  const [rows] = await conn.query<mysql.RowDataPacket[]>('SELECT filename, checksum FROM schema_migrations');
  const applied = new Map(rows.map((r) => [r.filename as string, r.checksum as string]));
  const files = readdirSync(sqlDir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
  const done: string[] = [];
  for (const file of files) {
    const sql = readFileSync(join(sqlDir, file), 'utf8');
    const sum = sha256(sql);
    const prev = applied.get(file);
    if (prev) {
      if (prev !== sum) {
        throw new Error(`${file} è già applicata ma il file è cambiato: crea una nuova migrazione o usa db:reset (solo dev).`);
      }
      continue;
    }
    const n = await runScript(conn, sql);
    await conn.query('INSERT INTO schema_migrations (filename, checksum) VALUES (?, ?)', [file, sum]);
    log(`  ✓ ${file} (${n} statement)`);
    done.push(file);
  }
  return done;
}

/** Azzera il database (solo *_dev/_test/_staging), applica le migrazioni ed esegue il seed. */
export async function resetDatabase(p: DbParams, sqlDir: string, seedSql: string, log: (msg: string) => void = () => {}) {
  assertResettable(p.database);
  const conn = await connect(p, false);
  try {
    await conn.query(`DROP DATABASE IF EXISTS ${mysql.escapeId(p.database)}`);
  } finally {
    await conn.end();
  }
  const db = await connectOrCreate(p);
  try {
    await migrate(db, sqlDir, log);
    await runScript(db, seedSql);
    log('  ✓ seed');
  } finally {
    await db.end();
  }
}
