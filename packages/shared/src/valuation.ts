import type { ValuationCfg } from './config';
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
