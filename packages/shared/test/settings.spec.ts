import gameConfig from '../../../data/game_config.json';
import { flattenSettings } from '../src/settings';

describe('flattenSettings', () => {
  const { settings, skipped } = flattenSettings(gameConfig);
  const map = new Map(settings);

  it('appiattisce tutta la config reale senza superare i limiti della tabella', () => {
    expect(settings.length).toBeGreaterThan(50);
  });

  it('numeri e booleani in forma leggibile da CAST in SQL', () => {
    expect(map.get('economy.market_fee_pct')).toBe('5');
    expect(map.get('economy.bots.buy_pct')).toBe('0.7');
    expect(map.get('player.max_inventory')).toBe('12');
    expect(map.get('chain.enabled')).toBe('1');
  });

  it('array di scalari come JSON (per JSON_LENGTH / JSON_EXTRACT nelle SP)', () => {
    expect(JSON.parse(map.get('player.starter_item_pool')!)).toEqual(gameConfig.player.starter_item_pool);
    expect(JSON.parse(map.get('avatar.skin_tones')!)).toHaveLength(gameConfig.avatar.skin_tones.length);
  });

  it('salta gli array di oggetti e le note', () => {
    expect(skipped).toContain('first_run.beats');
    expect([...map.keys()].some((k) => k.split('.').some((p) => p.startsWith('_')))).toBe(false);
  });

  it('rifiuta valori troppo lunghi', () => {
    expect(() => flattenSettings({ a: 'x'.repeat(256) })).toThrow(/oltre 255/);
  });
});
