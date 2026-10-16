import type { DropInfo } from '@sp/shared';
import type { Api } from '../net/api';
import { h, toast } from './dom';
import { npcLine } from './npc';
import { act, openPanel } from './panel';
import { openPassport } from './passport';
import { shoeColorway, shoeIcon, shoeName } from './shoe';
import { serverNow, store, subscribe } from './store';
import { T } from './texts';

/** Banca Upthere (GAME_DESIGN §11): il drop aperto, oppure quanto manca al prossimo. */
export function openBank(api: Api): void {
  const panel = openPanel(T.bankTitle, 'bank');
  const greeting = npcLine('banca', 'idle');
  let dropKey = '';

  const render = () => {
    const d = store.drop.current;
    const now = serverNow();
    const key = d ? `${d.dropId}|${d.sold}` : `none|${Math.ceil((store.drop.nextAt - now) / 1000)}`;
    // il bottone Compra non va ricreato a ogni secondo: si aggiorna solo il conto alla rovescia
    if (d && key === dropKey) {
      const left = panel.body.querySelector('.drop-left');
      if (left) left.textContent = T.dropLeft(T.countdown(Math.max(0, Math.ceil((d.closesAt - now) / 1000))));
      return;
    }
    dropKey = key;
    panel.body.replaceChildren(...(d ? dropView(d, now) : idleView(now)));
  };

  const idleView = (now: number) => [
    h('p', { class: 'npc-line' }, greeting ?? ''),
    h('p', { class: 'panel-summary' }, T.bankNext(T.countdown(Math.max(0, Math.ceil((store.drop.nextAt - now) / 1000))))),
  ];

  const dropView = (d: DropInfo, now: number) => {
    const buy = h('button', { class: 'btn btn-primary', type: 'button' }, T.dropBuy(d.price));
    buy.addEventListener('click', () =>
      void act(buy, async () => {
        const { assetId } = await api.dropClaim(d.dropId);
        toast(T.dropBought(shoeName(d.itemId)));
        openPassport(api, assetId);
      }),
    );
    return [
      h('p', { class: 'npc-line' }, npcLine('banca', 'drop_open', { qty: d.quantity, item: shoeName(d.itemId), price: d.price }) ?? ''),
      h(
        'div',
        { class: 'pp-head' },
        shoeIcon(d.itemId, true),
        h(
          'div',
          { class: 'pp-id' },
          h('h3', { class: 'pp-name' }, shoeName(d.itemId)),
          h('p', { class: 'pp-sub' }, shoeColorway(d.itemId)),
          h('p', { class: 'pp-value' }, T.dropSold(d.sold, d.quantity)),
          h('p', { class: 'pp-sub drop-left' }, T.dropLeft(T.countdown(Math.max(0, Math.ceil((d.closesAt - now) / 1000))))),
        ),
      ),
      buy,
    ];
  };

  panel.onClose(subscribe('drop', render));
  panel.onClose(subscribe('tick', render));
  render();
}
