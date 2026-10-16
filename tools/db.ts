// npm run db:migrate | db:seed | db:reset
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, dbParams, loadEnv } from './lib/env';
import { connectOrCreate, migrate, resetDatabase, runScript } from './lib/sql-runner';

const SQL_DIR = join(REPO_ROOT, 'sql');
const SEED_DIR = join(SQL_DIR, 'seed');

function seedSql(): string {
  return readdirSync(SEED_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(SEED_DIR, f), 'utf8'))
    .join('\n');
}

async function main(cmd: string | undefined): Promise<void> {
  loadEnv();
  const p = dbParams();
  const log = (m: string) => console.log(m);
  switch (cmd) {
    case 'migrate': {
      const conn = await connectOrCreate(p);
      try {
        const done = await migrate(conn, SQL_DIR, log);
        console.log(done.length ? `${p.database}: ${done.length} migrazioni applicate` : `${p.database}: già aggiornato`);
      } finally {
        await conn.end();
      }
      break;
    }
    case 'seed': {
      const conn = await connectOrCreate(p);
      try {
        await runScript(conn, seedSql());
        console.log(`${p.database}: seed applicato`);
      } finally {
        await conn.end();
      }
      break;
    }
    case 'reset':
      console.log(`${p.database}: reset`);
      await resetDatabase(p, SQL_DIR, seedSql(), log);
      break;
    default:
      throw new Error('uso: tsx tools/db.ts migrate|seed|reset');
  }
}

main(process.argv[2]).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
