import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Root del repo: la cartella che contiene data/game_config.json (vale sia da src/ sia da dist/). */
export const REPO_ROOT = process.env.SP_ROOT ?? findRepoRoot(__dirname);

function findRepoRoot(from: string): string {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'data', 'game_config.json'))) return dir;
    if (dirname(dir) === dir) throw new Error(`data/game_config.json non trovato risalendo da ${from}`);
  }
}

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

export function dbParams(): DbParams {
  return {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? 'sp_dev',
    password: process.env.DB_PASSWORD ?? 'sp_dev',
    database: process.env.DB_NAME ?? 'sneaker_passport_dev',
  };
}

/** Segreto per ricavare i codici di recupero dal device (vedi game/identity.ts). Obbligatorio in produzione. */
export function recoverySecret(): string {
  const secret = process.env.RECOVERY_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('RECOVERY_SECRET mancante o più corto di 32 caratteri: obbligatorio in produzione');
  }
  return 'sviluppo-non-usare-in-produzione-0123456789';
}
