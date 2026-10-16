import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import mysql from 'mysql2';
import { flattenSettings } from '../../packages/shared/src/settings';
import type { GameConfig, GameItem } from '../../packages/shared/src/config';

interface NpcsFile {
  system_players: { player_id: number; role: 'TREASURY' | 'SHOP' | 'STALL' | 'LEGEND'; name: string }[];
  bots: { player_id: number; nickname: string }[];
}

const q = (v: string | number) => mysql.escape(v);

function readJson<T>(root: string, file: string): T {
  return JSON.parse(readFileSync(join(root, 'data', file), 'utf8')) as T;
}

/**
 * Costruisce il seed SQL da data/*.json: game_settings, items, contatori, account di sistema, bot e
 * dotazione della tesoreria. È idempotente: si può rilanciare dopo aver cambiato i JSON.
 */
export function buildSeedSql(root: string): string {
  const config = readJson<GameConfig>(root, 'game_config.json');
  const { items } = readJson<{ items: GameItem[] }>(root, 'game_items.json');
  const npcs = readJson<NpcsFile>(root, 'npcs.json');

  validate(config, items, npcs);

  const { settings, skipped } = flattenSettings(config);
  const sys = config.economy.system_players;

  const players = [
    ...npcs.system_players.map((p) => [p.player_id, p.role, p.name] as const),
    ...npcs.bots.map((b) => [b.player_id, 'BOT', b.nickname] as const),
  ].sort((a, b) => a[0] - b[0]);

  const lines: string[] = [
    '-- GENERATO da tools/seed-from-json.ts a partire da data/*.json: non modificare a mano.',
    '-- Idempotente: si può rilanciare (npm run db:seed). In produzione si lancia a mano dopo le migrazioni.',
    `-- Chiavi di config non sincronizzate (array di oggetti, servono solo al codice TS): ${skipped.join(', ') || 'nessuna'}`,
    'SET NAMES utf8mb4;',
    '',
    'START TRANSACTION;',
    '',
    'DELETE FROM game_settings;',
    'INSERT INTO game_settings (name, value) VALUES',
    settings.map(([k, v]) => `  (${q(k)}, ${q(v)})`).join(',\n') + ';',
    '',
    '-- VALUES() in ON DUPLICATE KEY UPDATE è deprecato da MySQL 8.0.20 ma funziona su tutta la 8.0',
    '-- (la sintassi con alias richiederebbe la 8.0.19, lo schema chiede solo la 8.0.16).',
    'INSERT INTO items (id, tier, rarity, base_value, fakeable, drop_weight, sources) VALUES',
    items
      .map(
        (i) =>
          `  (${q(i.id)}, ${q(i.tier)}, ${q(i.rarity)}, ${i.base_value}, ${i.fakeable ? 1 : 0}, ${i.drop_weight}, ${q(JSON.stringify(i.sources))})`,
      )
      .join(',\n'),
    'ON DUPLICATE KEY UPDATE tier = VALUES(tier), rarity = VALUES(rarity), base_value = VALUES(base_value),',
    '  fakeable = VALUES(fakeable), drop_weight = VALUES(drop_weight), sources = VALUES(sources);',
    '',
    'INSERT INTO item_counters (item_id) VALUES',
    items.map((i) => `  (${q(i.id)})`).join(',\n'),
    'ON DUPLICATE KEY UPDATE item_id = item_id;',
    '',
    'INSERT INTO players (id, is_system, system_role, nickname) VALUES',
    players.map(([id, role, name]) => `  (${id}, 1, ${q(role)}, ${q(name)})`).join(',\n'),
    'ON DUPLICATE KEY UPDATE is_system = 1, system_role = VALUES(system_role), nickname = VALUES(nickname);',
    '',
    'COMMIT;',
    '',
    `-- Dotazione della tesoreria (id ${sys.treasury}): una sola volta, anche se il seed viene rilanciato.`,
    `CALL sp_treasury_seed(${config.economy.treasury_initial});`,
    '',
  ];
  return lines.join('\n');
}

function validate(config: GameConfig, items: GameItem[], npcs: NpcsFile): void {
  const errors: string[] = [];
  const sys = config.economy.system_players;
  const expected: Record<string, number> = { TREASURY: sys.treasury, SHOP: sys.shop, STALL: sys.stall, LEGEND: sys.legend };
  for (const [role, id] of Object.entries(expected)) {
    const p = npcs.system_players.find((x) => x.role === role);
    if (!p) errors.push(`npcs.json: manca l'account di sistema ${role}`);
    else if (p.player_id !== id) errors.push(`npcs.json: ${role} ha id ${p.player_id}, la config dice ${id}`);
  }
  if (npcs.bots.length !== config.economy.bots.count) {
    errors.push(`npcs.json: ${npcs.bots.length} bot, la config ne chiede ${config.economy.bots.count}`);
  }
  npcs.bots.forEach((b, i) => {
    if (b.player_id !== sys.bots_from + i) errors.push(`npcs.json: il bot ${b.nickname} dovrebbe avere id ${sys.bots_from + i}`);
  });
  const maxSystemId = Math.max(...Object.values(expected), sys.bots_from + npcs.bots.length - 1);
  if (maxSystemId >= 1000) errors.push('gli id di sistema devono stare sotto 1000 (AUTO_INCREMENT dei giocatori)');

  const ids = new Set(items.map((i) => i.id));
  for (const id of config.player.starter_item_pool) {
    if (!ids.has(id)) errors.push(`player.starter_item_pool: item sconosciuto ${id}`);
  }
  if (errors.length) throw new Error(`Seed non valido:\n- ${errors.join('\n- ')}`);
}
