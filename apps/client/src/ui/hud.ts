import { gameConfig } from '../config';
import { h, uiRoot } from './dom';
import { T } from './texts';

/** HUD: nickname, monete, valore armadio; armadio e barra delle emote (niente chat libera). */
export function showHud(nickname: string, onEmote: (emote: string) => void, onWardrobe: () => void) {
  const coins = h('span', { class: 'pill' });
  const wardrobe = h('button', { class: 'pill', type: 'button', onclick: onWardrobe });
  const bar = h('div', { class: 'emote-bar', hidden: true });
  for (const e of gameConfig.world.emotes) {
    bar.append(
      h('button', {
        class: 'emote',
        type: 'button',
        onclick: () => {
          onEmote(e);
          bar.hidden = true;
        },
      }, e),
    );
  }
  const toggle = h('button', { class: 'emote-toggle', type: 'button', 'aria-label': T.emotes, onclick: () => (bar.hidden = !bar.hidden) }, '😀');
  const el = h(
    'div',
    { class: 'hud' },
    h('div', { class: 'hud-top' }, h('span', { class: 'pill name' }, nickname), h('span', { class: 'spacer' }), coins, wardrobe),
    h(
      'div',
      { class: 'hud-bottom' },
      h('button', { class: 'hud-btn', type: 'button', onclick: onWardrobe }, h('span', { 'aria-hidden': 'true' }, '👟'), T.wardrobeOpen),
      h('span', { class: 'spacer' }),
      bar,
      toggle,
    ),
  );
  uiRoot().append(el);
  return {
    setWallet(c: number, w: number) {
      coins.textContent = T.hudCoins(c);
      wardrobe.textContent = T.hudWardrobe(w);
    },
    close: () => el.remove(),
  };
}

/** Schermata bloccante (sessione sostituita): un bottone per riprendersi la partita da qui. */
export function showBlocker(text: string, cta: string, onCta: () => void): void {
  const el = h('section', { class: 'screen blocker' }, h('p', {}, text), h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => { el.remove(); onCta(); } }, cta));
  uiRoot().append(el);
}
