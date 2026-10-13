import type { GameConfig } from '@sp/shared';
import gameConfigJson from '../../../data/game_config.json';
import npcsJson from '../../../data/npcs.json';

// Numeri e testi di gioco solo da data/*.json (CLAUDE.md, regola 7). catalog_reference.json non va MAI importato qui.
export const gameConfig = gameConfigJson as unknown as GameConfig;

export type NpcSprite =
  | { type: 'sheet'; key: string; flipX?: boolean }
  | { type: 'avatar'; skin: number; hair_style: string; hair_color: string; outfit_color: string; shoes_color: string };

export interface NpcInfo {
  name: string;
  zone: string;
  sprite: NpcSprite;
  lines: Record<string, string[]>;
}

const raw = npcsJson as unknown as { system_players: NpcInfo[]; service_npcs: NpcInfo[] };

/** NPC per zona della mappa (banca, negozio, bancarella, palco, autenticatore, enoteca). */
export const npcByZone: ReadonlyMap<string, NpcInfo> = new Map(
  [...raw.system_players, ...raw.service_npcs].map((n) => [n.zone, n]),
);
