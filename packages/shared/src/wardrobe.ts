/** Valore armadio = monete + somma dei valori percepiti delle scarpe possedute (GAME_DESIGN §5). */
export function wardrobeValue(coins: number, perceivedValues: readonly number[]): number {
  return perceivedValues.reduce((sum, v) => sum + v, coins);
}

/** Obiettivo della prima run: valore armadio finale ≥ iniziale × first_run.objective.multiplier, arrotondato su. */
export function runTarget(startValue: number, multiplier: number): number {
  // l'epsilon assorbe l'errore dei float (100 × 1.3 = 130.00000000000003 → 130, non 131)
  return Math.ceil(startValue * multiplier - 1e-9);
}

/** Crescita richiesta in percentuale, per i testi ("fai crescere del 30%"). */
export const runGrowthPct = (multiplier: number) => Math.round((multiplier - 1) * 100);
