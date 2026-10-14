import type { RunState } from '@sp/shared';
import { gameConfig } from '../config';
import { h, uiRoot } from './dom';
import { serverNow } from './store';
import { T } from './texts';

export interface HudActions {
  onEmote(emote: string): void;
  onWardrobe(): void;
  onLeaderboard(): void;
  onProfile(): void;
}

/**
 * HUD: nickname (tap → profilo), monete, valore armadio; durante la prima run il conto alla rovescia con
 * l'obiettivo; in basso armadio, classifica ed emote (niente chat libera).
 */
export function showHud(nickname: string, actions: HudActions) {
  const coins = h('span', { class: 'pill' });
  const wardrobe = h('button', { class: 'pill', type: 'button', onclick: actions.onWardrobe });
  const name = h('button', { class: 'pill name', type: 'button', onclick: actions.onProfile }, nickname);
  const runPill = h('span', { class: 'pill run-pill', role: 'timer', hidden: true });
  const bar = h('div', { class: 'emote-bar', hidden: true });
  for (const e of gameConfig.world.emotes) {
    bar.append(
      h('button', {
        class: 'emote',
        type: 'button',
        onclick: () => {
          actions.onEmote(e);
          bar.hidden = true;
        },
      }, e),
    );
  }
  const toggle = h('button', { class: 'emote-toggle', type: 'button', 'aria-label': T.emotes, onclick: () => (bar.hidden = !bar.hidden) }, '😀');
  const el = h(
    'div',
    { class: 'hud' },
    h(
      'div',
      { class: 'hud-head' },
      h('div', { class: 'hud-top' }, name, h('span', { class: 'spacer' }), coins, wardrobe),
      h('div', { class: 'hud-run' }, runPill),
    ),
    h(
      'div',
      { class: 'hud-bottom' },
      h('button', { class: 'hud-btn', type: 'button', onclick: actions.onWardrobe }, h('span', { 'aria-hidden': 'true' }, '👟'), T.wardrobeOpen),
      h(
        'button',
        { class: 'hud-btn hud-icon', type: 'button', 'aria-label': T.leaderboardOpen, title: T.leaderboardOpen, onclick: actions.onLeaderboard },
        h('span', { 'aria-hidden': 'true' }, '🏆'),
      ),
      h('span', { class: 'spacer' }),
      bar,
      toggle,
    ),
  );
  uiRoot().append(el);

  let run: RunState | null = null;
  let value = 0;
  const renderRun = () => {
    const left = run && !run.completed ? Math.max(0, Math.ceil((run.endsAt - serverNow()) / 1000)) : 0;
    runPill.hidden = !run || run.completed;
    if (!run || run.completed) return;
    const time = T.countdown(left);
    runPill.textContent = value >= run.target ? T.runReached(time) : T.runTimer(time, run.target);
    runPill.classList.toggle('reached', value >= run.target);
  };

  return {
    setWallet(c: number, w: number) {
      coins.textContent = T.hudCoins(c);
      wardrobe.textContent = T.hudWardrobe(w);
      value = w;
      renderRun();
    },
    setRun(state: RunState | null) {
      run = state;
      name.textContent = state?.merchant ? `${nickname} 🏅` : nickname;
      renderRun();
    },
    /** Ogni secondo (topic tick): il conto alla rovescia. */
    tick: renderRun,
    close: () => el.remove(),
  };
}

/** Schermata bloccante (sessione sostituita): un bottone per riprendersi la partita da qui. */
export function showBlocker(text: string, cta: string, onCta: () => void): void {
  const el = h('section', { class: 'screen blocker' }, h('p', {}, text), h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => { el.remove(); onCta(); } }, cta));
  uiRoot().append(el);
}
