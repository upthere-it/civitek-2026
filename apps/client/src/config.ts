import type { GameConfig, GameItem } from '@sp/shared';
import gameConfigJson from '../../../data/game_config.json';
import gameItemsJson from '../../../data/game_items.json';
import npcsJson from '../../../data/npcs.json';

// Numeri e testi di gioco solo da data/*.json (CLAUDE.md, regola 7). catalog_reference.json non va MAI importato qui.
export const gameConfig = gameConfigJson as unknown as GameConfig;

export type NpcSprite =
  | { type: 'sheet'; key: string; flipX?: boolean }
  | { type: 'avatar'; skin: number; hair_style: string; hair_color: string; outfit_color: string; shoes_color: string };

/** Bottiglia demo dell'Enoteca DOP Digital (GAME_DESIGN §15): dati statici, non si compra né si scambia. */
export interface DemoBottle {
  label: string;
  name: string;
  timeline: { step: string; detail: string; certified: boolean }[];
  cta: { text: string; url: string };
}

export interface NpcInfo {
  name: string;
  zone: string;
  sprite: NpcSprite;
  lines: Record<string, string[]>;
  demo_bottle?: DemoBottle;
}

const raw = npcsJson as unknown as { system_players: NpcInfo[]; service_npcs: NpcInfo[] };

/** NPC per zona della mappa (banca, negozio, bancarella, palco, autenticatore, enoteca). */
export const npcByZone: ReadonlyMap<string, NpcInfo> = new Map(
  [...raw.system_players, ...raw.service_npcs].map((n) => [n.zone, n]),
);

/** Campi di un item che arrivano al client (il resto lo toglie il plugin sp-client-items in vite.config.ts). */
export type ClientItem = Pick<GameItem, 'id' | 'brand' | 'name' | 'display_name' | 'colorway' | 'silhouette' | 'palette' | 'tier' | 'rarity' | 'flavor'>;

const items: ReadonlyMap<string, ClientItem> = new Map(
  (gameItemsJson as unknown as { items: ClientItem[] }).items.map((i) => [i.id, i]),
);

export const itemInfo = (id: string): ClientItem | undefined => items.get(id);
