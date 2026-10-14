import gameConfig from '../../../data/game_config.json';
import gameItems from '../../../data/game_items.json';
import { assetViewFromChain, listingPriceRange, marketFee, perceivedValue } from '../src/valuation';
import type { AssetView, ChainLink } from '../src/types';
import type { ValuationCfg } from '../src/config';

const cfg: ValuationCfg = gameConfig.valuation;
const TREASURY = gameConfig.economy.system_players.treasury;
const salto4Club = gameItems.items.find((i) => i.id === 'salto-4-club')!;

const view = (over: Partial<AssetView> = {}): AssetView => ({
  isFake: false,
  fakeRevealed: false,
  legendCount: 0,
  mintedByUpthere: false,
  originGap: false,
  humanOwnersCount: 1,
  ...over,
});

describe('perceivedValue — esempi di GAME_DESIGN §8 (Salto 4 Club)', () => {
  it('ha base 84, come nella tabella', () => {
    expect(salto4Club.base_value).toBe(84);
  });

  it('comprata al drop, Upthere primo proprietario → 105', () => {
    expect(perceivedValue(view({ mintedByUpthere: true }), 84, cfg)).toBe(105);
  });

  it('+ indossata una volta da MC Suola → 139', () => {
    expect(perceivedValue(view({ mintedByUpthere: true, legendCount: 1 }), 84, cfg)).toBe(139);
  });

  it('…poi passata per 8 proprietari umani (−15%) → 118', () => {
    expect(
      perceivedValue(view({ mintedByUpthere: true, legendCount: 1, humanOwnersCount: 8 }), 84, cfg),
    ).toBe(118);
  });

  it('falso di Tony Affari non verificato → 34', () => {
    expect(perceivedValue(view({ isFake: true, originGap: true }), 84, cfg)).toBe(34);
  });

  it('falso smascherato dalla Dott.ssa Hash → 2', () => {
    expect(perceivedValue(view({ isFake: true, originGap: true, fakeRevealed: true, legendCount: 2 }), 84, cfg)).toBe(
      cfg.fake_value_after_auth,
    );
  });
});

describe('perceivedValue — limiti', () => {
  it('il bonus di MC Suola conta al massimo legend_max_counted volte', () => {
    const two = perceivedValue(view({ legendCount: 2 }), 84, cfg);
    expect(perceivedValue(view({ legendCount: 5 }), 84, cfg)).toBe(two);
  });

  it('la penalità di flip non scende sotto flip_floor', () => {
    expect(perceivedValue(view({ humanOwnersCount: 100 }), 100, cfg)).toBe(Math.round(100 * cfg.flip_floor));
  });

  it('fino a flip_free_owners passaggi non c’è penalità', () => {
    expect(perceivedValue(view({ humanOwnersCount: cfg.flip_free_owners }), 84, cfg)).toBe(84);
  });

  it('con origine non certificata il bonus Upthere non si applica', () => {
    expect(perceivedValue(view({ mintedByUpthere: true, originGap: true }), 84, cfg)).toBe(34);
  });

  it('non scende mai sotto min_value', () => {
    expect(perceivedValue(view({ originGap: true }), 1, cfg)).toBe(cfg.min_value);
  });
});

describe('assetViewFromChain', () => {
  const link = (event: ChainLink['event'], toId: number, toIsSystem = false): ChainLink => ({ event, toId, toIsSystem });

  it('drop: mintedByUpthere e un solo proprietario umano', () => {
    const v = assetViewFromChain(
      { isFake: false, fakeRevealed: false, legendCount: 0, mintedBy: TREASURY },
      [link('MINT', 1001)],
      TREASURY,
    );
    expect(v).toMatchObject({ mintedByUpthere: true, originGap: false, humanOwnersCount: 1 });
  });

  it('falso: originGap dal FAKE_MINT, il passaggio da Tony non conta come proprietario umano', () => {
    const v = assetViewFromChain(
      { isFake: true, fakeRevealed: false, legendCount: 0, mintedBy: 3 },
      [link('FAKE_MINT', 3, true), link('TRANSFER', 1001)],
      TREASURY,
    );
    expect(v).toMatchObject({ originGap: true, mintedByUpthere: false, humanOwnersCount: 1 });
  });

  it('il prestito a MC Suola non aggiunge proprietari', () => {
    const v = assetViewFromChain(
      { isFake: false, fakeRevealed: false, legendCount: 1, mintedBy: 2 },
      [link('MINT', 1001), link('LEGEND_IN', 4, true), link('LEGEND_OUT', 1001)],
      TREASURY,
    );
    expect(v.humanOwnersCount).toBe(1);
  });

  it('il ping-pong tra due giocatori conta ogni passaggio', () => {
    const chain = [link('MINT', 1001), link('TRANSFER', 1002), link('TRANSFER', 1001), link('TRANSFER', 1002)];
    const v = assetViewFromChain({ isFake: false, fakeRevealed: false, legendCount: 0, mintedBy: 2 }, chain, TREASURY);
    expect(v.humanOwnersCount).toBe(4);
  });
});

describe('bacheca: fascia di prezzo e commissione (stesse regole delle SP)', () => {
  const economy = { listing_min_price: 2, listing_max_multiplier: 5, market_fee_pct: 5, market_fee_min: 1 };

  it('prezzo tra il minimo e valore × moltiplicatore', () => {
    expect(listingPriceRange(30, economy)).toEqual({ min: 2, max: 150 });
    expect(listingPriceRange(0, economy)).toEqual({ min: 2, max: 2 });
  });

  it('commissione: percentuale arrotondata per eccesso, con un minimo, mai oltre il prezzo', () => {
    expect(marketFee(100, economy)).toBe(5);
    expect(marketFee(21, economy)).toBe(2);
    expect(marketFee(10, economy)).toBe(1);
    expect(marketFee(1, { ...economy, market_fee_min: 3 })).toBe(1);
  });
});
