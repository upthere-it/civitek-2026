import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameConfig, GameItem } from '@sp/shared';
import { REPO_ROOT } from './env';

/** data/game_config.json e data/game_items.json, letti una volta all'avvio. Nessun numero di gioco nel codice. */
export class GameConfigService {
  private readonly byId: ReadonlyMap<string, GameItem>;

  constructor(
    readonly config: GameConfig,
    readonly items: readonly GameItem[],
  ) {
    this.byId = new Map(items.map((i) => [i.id, i]));
  }

  static fromRepo(root: string = REPO_ROOT): GameConfigService {
    const read = <T>(file: string): T => JSON.parse(readFileSync(join(root, 'data', file), 'utf8')) as T;
    return new GameConfigService(read<GameConfig>('game_config.json'), read<{ items: GameItem[] }>('game_items.json').items);
  }

  get chain() {
    return this.config.chain;
  }

  get economy() {
    return this.config.economy;
  }

  get valuation() {
    return this.config.valuation;
  }

  get player() {
    return this.config.player;
  }

  item(id: string): GameItem | undefined {
    return this.byId.get(id);
  }
}
