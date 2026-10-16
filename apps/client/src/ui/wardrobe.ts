import type { InventoryItem } from '@sp/shared';
import type { Api } from '../net/api';
import { h, toast } from './dom';
import { act, openPanel, row } from './panel';
import { openPassport } from './passport';
import { pricePicker } from './price';
import { shoeBadge, shoeColorway, shoeText } from './shoe';
import { serverNow, store, subscribe } from './store';
import { T } from './texts';

/** Armadio: le tue scarpe, il loro valore, Vendi / Ritira. Tap su una scarpa → passaporto. */
export function openWardrobe(api: Api): void {
  const panel = openPanel(T.wardrobeTitle, 'wardrobe');
  // un selettore di prezzo aperto sopravvive ai ridisegni (arriva un inventory.updated mentre si sceglie)
  const pickers = new Map<number, HTMLElement>();

  const render = () => {
    const items = store.inventory;
    for (const id of pickers.keys()) {
      if (!items.some((i) => i.assetId === id && i.listingId === null)) pickers.delete(id);
    }
    panel.body.replaceChildren(
      h('p', { class: 'panel-summary' }, T.wardrobeSummary(items.length, store.wardrobeValue), ' · ', T.coins(store.coins)),
      ...(items.length ? items.map(itemRow) : [h('p', { class: 'muted' }, T.wardrobeEmpty)]),
    );
  };

  const itemRow = (it: InventoryItem): HTMLElement => {
    const sub = `${shoeColorway(it.itemId)} · ${T.serial(it.serial)} · ${T.value(it.perceivedValue)}`;
    const main = [shoeBadge(it), shoeText(it.itemId, sub)];
    if (it.lockedUntil !== null && it.lockedUntil > serverNow()) {
      return row(main, [h('span', { class: 'row-badge' }, T.atLegend)], () => openPassport(api, it.assetId));
    }
    if (it.listingId !== null) {
      const listingId = it.listingId;
      const cancel = h('button', { class: 'btn-small btn-secondary', type: 'button' }, T.unlist);
      cancel.addEventListener('click', () =>
        void act(cancel, async () => {
          await api.listingCancel(listingId);
          toast(T.unlisted);
        }),
      );
      return row(main, [h('span', { class: 'row-badge' }, T.listedAt(it.listingPrice ?? 0)), cancel], () => openPassport(api, it.assetId));
    }
    const sell = h('button', { class: 'btn-small btn-primary', type: 'button' }, T.sell);
    const wrap = h('div', { class: 'row-wrap' }, row(main, [sell], () => openPassport(api, it.assetId)));
    sell.addEventListener('click', () => {
      pickers.clear(); // un selettore alla volta
      pickers.set(
        it.assetId,
        pricePicker(it.perceivedValue, it.maxListPrice, async (price) => {
          await api.listingCreate(it.assetId, price);
          toast(T.listed);
        }),
      );
      render();
    });
    const picker = pickers.get(it.assetId);
    if (picker) {
      wrap.append(picker);
      sell.hidden = true;
    }
    return wrap;
  };

  panel.onClose(subscribe('inventory', render));
  render();
}
