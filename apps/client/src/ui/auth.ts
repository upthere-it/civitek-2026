import type { InventoryItem } from '@sp/shared';
import { gameConfig } from '../config';
import type { Api } from '../net/api';
import { h } from './dom';
import { npcLine } from './npc';
import { act, openPanel, row } from './panel';
import { openPassport } from './passport';
import { shoeBadge, shoeColorway, shoeName, shoeText } from './shoe';
import { serverNow, store, subscribe } from './store';
import { T } from './texts';

/** Dott.ssa Hash (GAME_DESIGN §9): per auth_cost verifica una tua scarpa. Il verdetto resta nel passaporto. */
export function openAuth(api: Api, onVerdict: (line: string | null) => void): void {
  const panel = openPanel(T.authTitle, 'auth');
  const cost = gameConfig.economy.auth_cost;
  let verdict: HTMLElement | null = null;

  const render = () => {
    const items = store.inventory.filter((i) => !(i.lockedUntil !== null && i.lockedUntil > serverNow()));
    panel.body.replaceChildren(
      h('p', { class: 'npc-line' }, npcLine('autenticatore', 'idle') ?? T.authHint(cost)),
      ...(verdict ? [verdict] : []),
      h('p', { class: 'panel-summary' }, T.authHint(cost), ' ', T.coins(store.coins)),
      ...(items.length ? items.map(itemRow) : [h('p', { class: 'muted' }, T.authEmpty)]),
    );
  };

  const itemRow = (it: InventoryItem): HTMLElement => {
    const main = [shoeBadge(it), shoeText(it.itemId, `${shoeColorway(it.itemId)} · ${T.serial(it.serial)}`)];
    if (it.status) {
      return row(main, [h('span', { class: 'row-badge' }, it.status === 'fake' ? T.authDoneFake : T.authDoneGenuine)], () =>
        openPassport(api, it.assetId),
      );
    }
    const btn = h('button', { class: 'btn-small btn-primary', type: 'button' }, T.authCta(cost));
    btn.addEventListener('click', () =>
      void act(btn, async () => {
        const res = await api.auth(it.assetId);
        const fake = res.verdict === 'fake';
        verdict = h(
          'div',
          { class: `verdict ${fake ? 'verdict-fake' : 'verdict-ok'}` },
          h('p', { class: 'verdict-title' }, `${shoeName(it.itemId)}: ${fake ? T.authFake : T.authGenuine}`),
        );
        onVerdict(npcLine('autenticatore', fake ? 'fake' : 'genuine'));
        render();
      }),
    );
    return row(main, [btn], () => openPassport(api, it.assetId));
  };

  panel.onClose(subscribe('inventory', render));
  render();
}
