import type { Api } from '../net/api';
import { RequestError } from '../net/socket';
import { h, toast } from './dom';
import { act, openPanel, row } from './panel';
import { openPassport } from './passport';
import { shoeColorway, shoeIcon, shoeName, shoeText } from './shoe';
import { store, subscribe } from './store';
import { T } from './texts';

/** Negozio: scarpe nuove a prezzo pieno. Dopo l'acquisto si apre il passaporto, con il primo anello ⏳ → ✅. */
export async function openShop(api: Api, npcLine: string | null): Promise<void> {
  const panel = openPanel(T.shopTitle, 'shop');
  let entries: Awaited<ReturnType<Api['shopList']>>;
  try {
    entries = (await api.shopList()).sort((a, b) => a.price - b.price);
  } catch (err) {
    toast(err instanceof RequestError ? err.message : T.genericError);
    panel.close();
    return;
  }

  const render = () => {
    panel.body.replaceChildren(
      ...(npcLine ? [h('p', { class: 'npc-line' }, npcLine)] : []),
      h('p', { class: 'panel-summary' }, T.coins(store.coins)),
      ...entries.map((e) => {
        const buy = h('button', { class: 'btn-small btn-primary', type: 'button' }, T.shopBuy(e.price));
        // senza monete il bottone resta attivo: la risposta del server ("Non hai abbastanza monete.") insegna di più
        buy.addEventListener('click', () =>
          void act(buy, async () => {
            const { assetId } = await api.shopBuy(e.itemId);
            toast(T.shopBought(shoeName(e.itemId)));
            openPassport(api, assetId);
          }),
        );
        return row([shoeIcon(e.itemId), shoeText(e.itemId, shoeColorway(e.itemId))], [buy]);
      }),
    );
  };

  if (panel.closed) return; // chiuso mentre caricava: niente iscrizione da lasciare appesa
  panel.onClose(subscribe('inventory', render));
  render();
}
