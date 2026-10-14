import { runGrowthPct, type RunState } from '@sp/shared';
import { gameConfig } from '../config';
import { bannerStack, h } from './dom';
import { T } from './texts';

/** Un beat resta sullo schermo al massimo questo tempo: è un suggerimento, non deve accumularsi. */
const BEAT_VISIBLE_MS = 12_000;

let current: HTMLElement | null = null;

export interface BeatAction {
  label: string;
  run(): void;
}

/** Testo di un beat (first_run.beats → GAME_DESIGN §5); null se il beat non ha un testo (es. reveal). */
export function beatText(beatId: string, run: RunState): string | null {
  const fr = gameConfig.first_run;
  switch (beatId) {
    case 'welcome':
      return T.beats.welcome(gameConfig.player.start_coins);
    case 'objective':
      return T.beats.objective(runGrowthPct(fr.objective.multiplier), run.target);
    case 'closing_warning': {
      const at = fr.beats.find((b) => b.id === beatId)?.at_sec ?? fr.duration_sec;
      return T.beats.closing_warning(fr.duration_sec - at);
    }
    case 'tooltip_move':
    case 'tooltip_passport':
    case 'hint_stall':
    case 'hint_legend':
    case 'hint_market':
      return T.beats[beatId]();
    default:
      return null;
  }
}

/** Banner del beat sotto l'HUD: non blocca il gioco, si chiude con un tap (o da solo). Uno alla volta. */
export function showBeat(text: string, action?: BeatAction): void {
  hideBeat();
  const close = () => hideBeat(el);
  const el = h(
    'div',
    { class: 'beat-banner', role: 'status' },
    h('p', { class: 'beat-text', onclick: close }, text),
    ...(action
      ? [h('button', { class: 'btn-small btn-primary', type: 'button', onclick: () => { close(); action.run(); } }, action.label)]
      : []),
    h('button', { class: 'panel-close', type: 'button', 'aria-label': T.close, onclick: close }, '×'),
  );
  current = el;
  bannerStack().append(el);
  setTimeout(close, BEAT_VISIBLE_MS);
}

export function hideBeat(only?: HTMLElement): void {
  if (only && current !== only) return;
  current?.remove();
  current = null;
}
