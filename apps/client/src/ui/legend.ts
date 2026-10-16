import type { InventoryItem } from '@sp/shared';
import { gameConfig } from '../config';
import type { Api } from '../net/api';
import { h } from './dom';
import { npcLine } from './npc';
import { act, openPanel, row } from './panel';
import { openPassport } from './passport';
import { shoeBadge, shoeColorway, shoeText } from './shoe';
import { serverNow, store, subscribe } from './store';
import { T } from './texts';

/** MC Suola (GAME_DESIGN §10): indossa la scarpa per qualche secondo e la fa entrare nella storia. */
export function openLegend(api: Api, onWear: (line: string | null) => void): void {
  const panel = openPanel(T.legendTitle, 'legend');
  const { cost, wear_duration_sec, cooldown_sec } = gameConfig.economy.legend;
  const maxCounted = gameConfig.valuation.legend_max_counted;
  let lastMood = '';
  let moodLine = '';

  const render = () => {
    const now = serverNow();
    const rest = store.legendReadyAt !== null ? Math.ceil((store.legendReadyAt - now) / 1000) : 0;
    const wearing = store.inventory.some((i) => i.lockedUntil !== null && i.lockedUntil > now);
    // la battuta cambia solo quando cambia lo stato, non a ogni secondo del conto alla rovescia
    const mood = wearing ? 'wearing' : rest > 0 ? 'cooldown' : 'idle';
    if (mood !== lastMood) {
      lastMood = mood;
      moodLine = npcLine('palco', mood) ?? '';
    }
    panel.body.replaceChildren(
      h('p', { class: 'npc-line' }, moodLine),
      h('p', { class: 'panel-summary' }, rest > 0 ? T.legendCooldown(rest) : T.legendHint(cost, wear_duration_sec), ' ', T.coins(store.coins)),
      ...store.inventory.map((it) => itemRow(it, now, rest > 0)),
    );
  };

  const itemRow = (it: InventoryItem, now: number, resting: boolean): HTMLElement => {
    const main = [shoeBadge(it), shoeText(it.itemId, `${shoeColorway(it.itemId)} · ${T.value(it.perceivedValue)}`)];
    const open = () => openPassport(api, it.assetId);
    if (it.lockedUntil !== null && it.lockedUntil > now) {
      return row(main, [h('span', { class: 'row-badge' }, T.legendWearing(Math.ceil((it.lockedUntil - now) / 1000)))], open);
    }
    if (it.legendCount >= maxCounted) return row(main, [h('span', { class: 'row-badge' }, T.legendMaxed)], open);
    const btn = h('button', { class: 'btn-small btn-primary', type: 'button' }, T.legendCta(cost));
    // in cooldown il bottone resta attivo: il messaggio del server spiega perché
    if (resting || it.listingId !== null) btn.classList.add('btn-dim');
    btn.addEventListener('click', () =>
      void act(btn, async () => {
        await api.legend(it.assetId);
        store.legendReadyAt = serverNow() + cooldown_sec * 1000;
        onWear(npcLine('palco', 'wearing'));
        render();
      }),
    );
    return row(main, [btn], open);
  };

  panel.onClose(subscribe('inventory', render));
  panel.onClose(subscribe('tick', render));
  render();
}
