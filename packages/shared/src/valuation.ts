import type { EconomyCfg, ValuationCfg } from './config';
import type { AssetView, ChainLink } from './types';

/**
 * Valore percepito di una scarpa (GAME_DESIGN §8). È l'unica implementazione: il server la usa come
 * autorità (limiti di prezzo, bot), il client solo per mostrarla.
 */
export function perceivedValue(a: AssetView, baseValue: number, cfg: ValuationCfg): number {
  if (a.isFake && a.fakeRevealed) return cfg.fake_value_after_auth;

  let mult = 1;
  mult += cfg.legend_bonus_per_wear * Math.min(a.legendCount, cfg.legend_max_counted);
  if (a.mintedByUpthere && !a.originGap) mult += cfg.upthere_mint_bonus;

  const extraOwners = Math.max(0, a.humanOwnersCount - cfg.flip_free_owners);
  mult *= Math.max(cfg.flip_floor, 1 - cfg.flip_penalty_per_owner * extraOwners);

  if (a.originGap) mult *= cfg.gap_multiplier;

  return Math.max(cfg.min_value, Math.round(baseValue * mult));
}

/**
 * Costruisce l'AssetView dalla catena (anelli dal più vecchio al più recente).
 *
 * `humanOwnersCount` conta i passaggi di proprietà verso un umano (MINT, FAKE_MINT, TRANSFER), non i
 * giocatori distinti: così anche il ping-pong tra due giocatori pesa come "troppi passaggi".
 * LEGEND_IN/LEGEND_OUT non contano: la scarpa torna allo stesso proprietario.
 */
export function assetViewFromChain(
  asset: { isFake: boolean; fakeRevealed: boolean; legendCount: number; mintedBy: number },
  chain: readonly ChainLink[],
  treasuryId: number,
): AssetView {
  const originGap = chain.length > 0 && chain[0].event === 'FAKE_MINT';
  const humanOwnersCount = chain.filter(
    (l) => !l.toIsSystem && (l.event === 'MINT' || l.event === 'FAKE_MINT' || l.event === 'TRANSFER'),
  ).length;
  return {
    isFake: asset.isFake,
    fakeRevealed: asset.fakeRevealed,
    legendCount: asset.legendCount,
    mintedByUpthere: asset.mintedBy === treasuryId,
    originGap,
    humanOwnersCount,
  };
}

/** Fascia di prezzo per mettere una scarpa in bacheca: la stessa regola di sp_listing_create. */
export function listingPriceRange(perceived: number, economy: Pick<EconomyCfg, 'listing_min_price' | 'listing_max_multiplier'>) {
  const min = economy.listing_min_price;
  return { min, max: Math.max(min, Math.floor(perceived * economy.listing_max_multiplier)) };
}

/** Commissione della bacheca su una vendita: la stessa regola di sp_listing_buy (il client la mostra soltanto). */
export function marketFee(price: number, economy: Pick<EconomyCfg, 'market_fee_pct' | 'market_fee_min'>): number {
  return Math.min(price, Math.max(economy.market_fee_min, Math.ceil((price * economy.market_fee_pct) / 100)));
}

/** Prezzo di un falso sul banco di Tony Affari: la stessa regola di sp_stall_buy. */
export function stallPrice(baseValue: number, economy: Pick<EconomyCfg, 'stall'>): number {
  return Math.max(1, Math.round(baseValue * economy.stall.price_pct_of_base));
}
