// Genera sql/seed/001_seed.sql da data/*.json (npm run db:seed lo rigenera e lo applica).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './lib/env';
import { buildSeedSql } from './lib/seed';

const out = join(REPO_ROOT, 'sql', 'seed', '001_seed.sql');
mkdirSync(join(REPO_ROOT, 'sql', 'seed'), { recursive: true });
writeFileSync(out, buildSeedSql(REPO_ROOT));
console.log(`seed generato: ${out}`);
