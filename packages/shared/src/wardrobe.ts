/** Valore armadio = monete + somma dei valori percepiti delle scarpe possedute (GAME_DESIGN §5). */
export function wardrobeValue(coins: number, perceivedValues: readonly number[]): number {
  return perceivedValues.reduce((sum, v) => sum + v, coins);
}
