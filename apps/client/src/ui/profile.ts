import type { RunState } from '@sp/shared';
import { h } from './dom';
import { act, openPanel } from './panel';
import { serverNow } from './store';
import { T } from './texts';

export interface ProfileInfo {
  nickname: string;
  /** Codice di recupero se questo telefono lo conosce (l'ha generato, o ci si è rientrati con quello). */
  code: string | null;
  run: RunState | null;
}

/** Profilo (GAME_DESIGN §14): il codice di recupero, la prima giornata (in corso o da rivedere), la classifica. */
export function openProfile(info: ProfileInfo, onReveal: () => Promise<void>, onLeaderboard: () => void): void {
  const panel = openPanel(T.profileTitle, 'profile');
  panel.body.append(
    h('p', { class: 'pp-name' }, info.run?.merchant ? `${info.nickname} 🏅` : info.nickname),
    h('div', { class: 'reveal-code' }, h('p', { class: 'muted' }, T.revealCodeTitle), ...(info.code
      ? [h('p', { class: 'code' }, info.code), h('p', { class: 'muted' }, T.revealCodeHint)]
      : [h('p', { class: 'muted' }, T.revealCodeUnknown)])),
  );
  if (info.run && !info.run.completed) {
    const left = Math.max(0, Math.ceil((info.run.endsAt - serverNow()) / 1000));
    panel.body.append(h('p', { class: 'muted' }, T.profileRun(T.countdown(left))));
  }
  if (info.run?.completed) {
    const day = h('button', { class: 'btn btn-secondary', type: 'button' }, T.profileDay);
    day.addEventListener('click', () => void act(day, async () => {
      await onReveal();
      panel.close();
    }));
    panel.foot.append(day);
  }
  panel.foot.append(h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { panel.close(); onLeaderboard(); } }, T.leaderboardOpen));
}
