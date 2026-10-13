import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const REPO_ROOT = resolve(__dirname, '..', '..');

/** Carica `.env` dalla root del repo, se c'è. Le variabili già presenti nell'ambiente vincono. */
export function loadEnv(): void {
  const file = join(REPO_ROOT, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

export interface DbParams {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export function dbParams(database = process.env.DB_NAME ?? 'sneaker_passport_dev'): DbParams {
  return {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? 'sp_dev',
    password: process.env.DB_PASSWORD ?? 'sp_dev',
    database,
  };
}

/** db:reset e i test distruggono il database: solo nomi da sviluppo. */
export function assertResettable(database: string): void {
  if (process.env.NODE_ENV === 'production' || !/_(dev|test|staging)$/.test(database)) {
    throw new Error(`Rifiuto di azzerare "${database}": ammessi solo database *_dev, *_test o *_staging, mai in produzione.`);
  }
}
