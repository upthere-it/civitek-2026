// Prima di tutti i test: database di test azzerato, migrazioni e seed generato dai JSON correnti.
import { join } from 'node:path';
import { buildSeedSql } from '../../../tools/lib/seed';
import { resetDatabase } from '../../../tools/lib/sql-runner';
import { REPO_ROOT, dbParams, loadEnv } from '../src/config/env';

export default async function globalSetup(): Promise<void> {
  loadEnv();
  const params = { ...dbParams(), database: process.env.DB_TEST_NAME ?? 'sneaker_passport_test' };
  try {
    await resetDatabase(params, join(REPO_ROOT, 'sql'), buildSeedSql(REPO_ROOT));
  } catch (err) {
    throw new Error(
      `Database di test non pronto (${params.user}@${params.host}:${params.port}/${params.database}). ` +
        `Serve MySQL 8 in esecuzione e le credenziali in .env (vedi .env.example).\n${String(err)}`,
    );
  }
}
