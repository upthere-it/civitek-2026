import type { Leaderboard } from '@sp/shared';
import { gameConfig } from '../config';
import { h, uiRoot } from './dom';
import { T } from './texts';

export interface HudActions {
  onEmote(emote: string): void;
  onWardrobe(): void;
  onLeaderboard(): void;
}

/**
 * HUD: nickname, monete, valore armadio e, sotto, la posizione in classifica sempre aggiornata (tap → classifica);
 * in basso armadio ed emote (niente chat libera).
 */
export function showHud(nickname: string, actions: HudActions) {
  const coins = h('span', { class: 'pill' });
  const wardrobe = h('button', { class: 'pill', type: 'button', onclick: actions.onWardrobe });
  const rank = h('button', { class: 'pill rank-pill', type: 'button', 'aria-label': T.leaderboardOpen, hidden: true, onclick: actions.onLeaderboard });
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
      h('div', { class: 'hud-top' }, h('span', { class: 'pill name' }, nickname), h('span', { class: 'spacer' }), coins, wardrobe),
      h('div', { class: 'hud-run' }, rank),
    ),
    h(
      'div',
      { class: 'hud-bottom' },
      h('button', { class: 'hud-btn', type: 'button', onclick: actions.onWardrobe }, h('span', { 'aria-hidden': 'true' }, '👟'), T.wardrobeOpen),
      h('span', { class: 'spacer' }),
      bar,
      toggle,
    ),
  );
  uiRoot().append(el);

  let lastRank = 0;
  return {
    setWallet(c: number, w: number) {
      coins.textContent = T.hudCoins(c);
      wardrobe.textContent = T.hudWardrobe(w);
    },
    /** Posizione live: se sale o scende la pillola pulsa una volta. */
    setRank(board: Leaderboard | null) {
      const r = board?.me?.rank ?? 0;
      rank.hidden = r === 0;
      if (!r) return;
      rank.textContent = T.hudRank(r);
      if (lastRank && r !== lastRank) {
        rank.classList.remove('up', 'down');
        void rank.offsetWidth; // riavvia l'animazione
        rank.classList.add(r < lastRank ? 'up' : 'down');
      }
      lastRank = r;
    },
    close: () => el.remove(),
  };
}

/** Schermata bloccante (sessione sostituita): un bottone per riprendersi la partita da qui. */
export function showBlocker(text: string, cta: string, onCta: () => void): void {
  const el = h('section', { class: 'screen blocker' }, h('p', {}, text), h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => { el.remove(); onCta(); } }, cta));
  uiRoot().append(el);
}
