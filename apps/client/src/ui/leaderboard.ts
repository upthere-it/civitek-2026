import type { AvatarLook, LeaderboardRow } from '@sp/shared';
import { h } from './dom';
import { openPanel } from './panel';
import { isMine, store, subscribe } from './store';
import { T } from './texts';

export type Thumb = (look: AvatarLook, shoesColor: string | null) => HTMLElement;

/**
 * Classifica live (GAME_DESIGN §13): top per valore armadio con avatar e nome, podio con le medaglie, e
 * sempre la propria posizione. Si ridisegna da sola a ogni `leaderboard.updated`.
 */
export function openLeaderboard(thumb: Thumb): void {
  const panel = openPanel(T.leaderboardTitle, 'leaderboard');
  // le miniature si compongono una volta per giocatore e aspetto: un aggiornamento ogni pochi secondi non le rifà
  const thumbs = new Map<string, HTMLElement>();
  const thumbOf = (r: LeaderboardRow) => {
    const key = `${r.playerId}|${JSON.stringify(r.look)}|${r.shoesColor}`;
    let el = thumbs.get(key);
    if (!el) thumbs.set(key, (el = thumb(r.look, r.shoesColor)));
    return el;
  };

  const line = (r: LeaderboardRow) => {
    const podium = r.rank <= T.podium.length;
    return h(
      'div',
      { class: `lb-row${podium ? ` lb-podium lb-${r.rank}` : ''}${isMine(r.playerId) ? ' lb-me' : ''}` },
      h('span', { class: 'lb-rank', 'aria-label': `${r.rank}°` }, podium ? T.podium[r.rank - 1] : String(r.rank)),
      thumbOf(r),
      h('span', { class: 'lb-name' }, r.nickname, ...(isMine(r.playerId) ? [h('span', { class: 'lb-you' }, ` (${T.leaderboardYou})`)] : [])),
      h('span', { class: 'lb-value' }, String(r.value)),
    );
  };

  const render = () => {
    const b = store.leaderboard;
    if (!b) {
      panel.body.replaceChildren(h('p', { class: 'muted' }, T.leaderboardLoading));
      return;
    }
    const rows = b.top.map(line);
    if (b.me && !b.top.some((r) => r.playerId === b.me!.playerId)) rows.push(h('div', { class: 'lb-gap', 'aria-hidden': 'true' }, '⋯'), line(b.me));
    panel.body.replaceChildren(h('p', { class: 'muted' }, T.leaderboardHint), ...(rows.length ? rows : [h('p', { class: 'muted' }, T.leaderboardEmpty)]));
  };
  panel.onClose(subscribe('leaderboard', render));
  render();
}
