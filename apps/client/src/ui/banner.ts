import type { DropInfo } from '@sp/shared';
import { bannerStack, h } from './dom';
import { shoeIcon, shoeName } from './shoe';
import { serverNow } from './store';
import { T } from './texts';

let current: HTMLElement | null = null;

/** Banner in alto per un drop appena aperto: si chiude con un tap, al "Vai" o quando il drop finisce. */
export function showDropBanner(d: DropInfo, onGo: () => void): void {
  hideDropBanner();
  const sec = Math.max(0, Math.round((d.closesAt - serverNow()) / 1000));
  const el = h(
    'div',
    { class: 'drop-banner', role: 'status' },
    shoeIcon(d.itemId),
    h('p', { class: 'drop-banner-text' }, T.dropBanner(d.quantity, shoeName(d.itemId), d.price, sec)),
    h('button', { class: 'btn-small btn-primary', type: 'button', onclick: () => { hideDropBanner(); onGo(); } }, T.dropGo),
    h('button', { class: 'panel-close', type: 'button', 'aria-label': T.close, onclick: () => hideDropBanner() }, '×'),
  );
  current = el;
  bannerStack().prepend(el);
}

export function hideDropBanner(): void {
  current?.remove();
  current = null;
}
