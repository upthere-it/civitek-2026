import type { AvatarLook, LeaderboardRow } from '@sp/shared';
import type { Api } from '../net/api';
import { RequestError } from '../net/socket';
import { h, toast } from './dom';
import { openPanel } from './panel';
import { isMine } from './store';
import { T } from './texts';

export type Thumb = (look: AvatarLook, shoesColor: string | null) => HTMLElement;

/** Classifica (GAME_DESIGN §13): top per valore armadio con avatar e nome, e sempre la propria posizione. */
export function openLeaderboard(api: Api, thumb: Thumb): void {
  const panel = openPanel(T.leaderboardTitle, 'leaderboard');
  panel.body.append(h('p', { class: 'muted' }, T.leaderboardHint));

  const line = (r: LeaderboardRow) =>
    h(
      'div',
      { class: `lb-row${isMine(r.playerId) ? ' lb-me' : ''}` },
      h('span', { class: 'lb-rank' }, String(r.rank)),
      thumb(r.look, r.shoesColor),
      h(
        'span',
        { class: 'lb-name' },
        r.nickname,
        ...(isMine(r.playerId) ? [h('span', { class: 'lb-you' }, ` (${T.leaderboardYou})`)] : []),
        ...(r.merchant ? [h('span', { class: 'lb-badge', title: T.leaderboardMerchant, 'aria-label': T.leaderboardMerchant }, ' 🏅')] : []),
      ),
      h('span', { class: 'lb-value' }, String(r.value)),
    );

  api
    .leaderboard()
    .then((b) => {
      if (panel.closed) return;
      const rows = b.top.map(line);
      if (b.me && !b.top.some((r) => r.playerId === b.me!.playerId)) rows.push(h('div', { class: 'lb-gap', 'aria-hidden': 'true' }, '⋯'), line(b.me));
      panel.body.append(...(rows.length ? rows : [h('p', { class: 'muted' }, T.leaderboardEmpty)]));
    })
    .catch((err) => {
      toast(err instanceof RequestError ? err.message : T.genericError);
      panel.close();
    });
}
