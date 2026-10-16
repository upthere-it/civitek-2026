import type { StallOffer } from '@sp/shared';
import type { Api } from '../net/api';
import { RequestError } from '../net/socket';
import { h, toast } from './dom';
import { npcLine } from './npc';
import { act, debounce, openPanel, row } from './panel';
import { openPassport } from './passport';
import { shoeColorway, shoeIcon, shoeName, shoeText } from './shoe';
import { subscribe } from './store';
import { T } from './texts';

/**
 * Bancarella di Tony Affari (GAME_DESIGN §9). Qui il "Compra" sta direttamente nella riga e la lista non mostra
 * il valore: chi apre il passaporto prima di comprare vede il ⚠️, chi non lo apre cade nella trappola.
 */
export function openStall(api: Api, onSale: () => void): void {
  const panel = openPanel(T.stallTitle, 'stall');
  const greeting = npcLine('bancarella', 'idle');

  const render = (offers: StallOffer[]) => {
    const first = offers[0];
    const pitch = first ? npcLine('bancarella', 'offer', { item: shoeName(first.itemId), price: first.price }) : null;
    panel.body.replaceChildren(
      ...[greeting, pitch].filter(Boolean).map((l) => h('p', { class: 'npc-line' }, l!)),
      ...(offers.length
        ? offers.map((o) => {
            const buy = h('button', { class: 'btn-small btn-primary', type: 'button' }, T.stallBuy(o.price));
            buy.addEventListener('click', () =>
              void act(buy, async () => {
                await api.stallBuy(o.assetId);
                toast(T.stallBought(shoeName(o.itemId)));
                onSale();
              }),
            );
            return row([shoeIcon(o.itemId), shoeText(o.itemId, T.stallSub(shoeColorway(o.itemId), o.serial))], [buy], () =>
              openPassport(api, o.assetId),
            );
          })
        : [h('p', { class: 'muted' }, T.stallEmpty)]),
    );
  };

  const load = async () => {
    try {
      const offers = await api.stallList();
      if (!panel.closed) render(offers);
    } catch (err) {
      toast(err instanceof RequestError ? err.message : T.genericError);
      panel.close();
    }
  };
  panel.onClose(subscribe('stall', debounce(() => !panel.closed && void load(), 300)));
  void load();
}
