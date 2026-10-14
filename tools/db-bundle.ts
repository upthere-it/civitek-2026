// npm run db:bundle -- [--from NNN] [--seed] [--out file.sql]
// Script SQL unico per la produzione, da lanciare A MANO (dbForge o client `mysql`): l'MCP punta solo al test
// e la produzione la allineano i dev di Upthere (CLAUDE.md, Database).
// - senza --from: database NUOVO. Tutte le migrazioni, le righe di schema_migrations con i checksum (così
//   `npm run db:migrate` le vede già applicate) e il seed. Si ferma se trova già la tabella players;
// - con --from NNN: solo le migrazioni da NNN in poi, per aggiornare un database già in uso (seed solo con --seed).
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { REPO_ROOT } from './lib/env';

const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true') : undefined;
};
const from = opt('from');
const withSeed = !from || opt('seed') === 'true';
const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const out = opt('out') ?? join(REPO_ROOT, 'deploy', 'out', `civitek_${from ? `da_${from}` : 'completo'}_${today}.sql`);

const SQL_DIR = join(REPO_ROOT, 'sql');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const files = readdirSync(SQL_DIR)
  .filter((f) => /^\d{3}_.+\.sql$/.test(f))
  .sort()
  .filter((f) => !from || f.slice(0, 3) >= from.padStart(3, '0'));
if (!files.length) {
  console.error(`nessuna migrazione da ${from}`);
  process.exit(1);
}

const parts: string[] = [
  `-- Sneaker Passport (civitek): ${from ? `aggiornamento dalle migrazioni ${from}` : 'database completo da zero'}`,
  `-- Generato da tools/db-bundle.ts il ${new Date().toISOString()}. Non modificare: si rigenera.`,
  '-- Prima di lanciarlo:',
  '--   1. selezionare il database giusto (USE …): lo script lavora sul database corrente;',
  '--   2. utente con SUPER oppure log_bin_trust_function_creators = 1 (fn_setting è una FUNCTION, sql/002);',
  '--   3. MySQL >= 8.0.16 (servono i CHECK).',
  `-- Contiene: ${files.join(', ')}${withSeed ? ', seed (sql/seed/001_seed.sql)' : ''}.`,
  '',
  'SET NAMES utf8mb4;',
  '',
];

if (!from) {
  parts.push(
    '-- Guardia: questo script crea il database da zero. Su un database già in uso si ferma qui.',
    'DROP PROCEDURE IF EXISTS _bundle_guard;',
    'DELIMITER $$',
    'CREATE PROCEDURE _bundle_guard()',
    'BEGIN',
    "  IF DATABASE() IS NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NO_DATABASE: seleziona il database con USE'; END IF;",
    "  IF (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'players') > 0 THEN",
    "    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DB_NOT_EMPTY: per un database in uso genera lo script con --from';",
    '  END IF;',
    'END$$',
    'DELIMITER ;',
    'CALL _bundle_guard();',
    'DROP PROCEDURE _bundle_guard;',
    '',
  );
}

parts.push(
  '-- Registro delle migrazioni (lo stesso di tools/lib/sql-runner.ts)',
  `CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   VARCHAR(191) NOT NULL PRIMARY KEY,
  checksum   CHAR(64) NOT NULL,
  applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;`,
  '',
);

for (const f of files) {
  const sql = readFileSync(join(SQL_DIR, f), 'utf8');
  parts.push(
    `-- ============================================================ ${f}`,
    sql.trimEnd(),
    '',
    // DELIMITER ; di sicurezza: ogni file lo rimette già, ma un file che finisse dentro un blocco $$ non deve trascinarlo
    'DELIMITER ;',
    `INSERT INTO schema_migrations (filename, checksum) VALUES ('${f}', '${sha256(sql)}');`,
    '',
  );
}

if (withSeed) {
  const seedDir = join(SQL_DIR, 'seed');
  for (const f of readdirSync(seedDir).filter((x) => x.endsWith('.sql')).sort()) {
    parts.push(`-- ============================================================ seed/${f}`, readFileSync(join(seedDir, f), 'utf8').trimEnd(), '');
  }
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${parts.join('\n')}\n`);
console.log(`scritto ${out}`);
console.log(`  ${files.length} migrazioni${withSeed ? ' + seed' : ''}`);
