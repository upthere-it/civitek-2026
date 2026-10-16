import { itemInfo } from '../config';
import type { PassportStatus } from '@sp/shared';
import { h } from './dom';

/**
 * Icona 32×32 della scarpa (docs/ASSETS.md §4: nelle liste HTML si usa items/{itemId}.png, pixelata).
 * Solo 32 o 64 px CSS: con densità 1, 2 e 3 il fattore resta intero e i pixel non si deformano.
 */
export function shoeIcon(itemId: string, big = false): HTMLImageElement {
  const size = big ? '64' : '32';
  return h('img', { class: big ? 'shoe-icon big' : 'shoe-icon', src: `assets/shoes/items/${itemId}.png`, width: size, height: size, alt: '' });
}

export const shoeName = (itemId: string) => itemInfo(itemId)?.display_name ?? itemId;
export const shoeColorway = (itemId: string) => itemInfo(itemId)?.colorway ?? '';

/** Titolo e sottotitolo di una riga: nome della scarpa e una riga di dettagli. */
export function shoeText(itemId: string, sub: string): HTMLElement {
  return h('div', { class: 'row-text' }, h('span', { class: 'row-name' }, shoeName(itemId)), h('span', { class: 'row-sub' }, sub));
}

/** Icona con il timbro della Dott.ssa Hash: ✅ autentica, ❌ falsa (GAME_DESIGN §9). */
export function shoeBadge(it: { itemId: string; status: PassportStatus }): HTMLElement {
  const icon = shoeIcon(it.itemId);
  if (!it.status) return icon;
  return h(
    'span',
    { class: `shoe-stamp stamp-${it.status}` },
    icon,
    h('span', { class: 'stamp', 'aria-label': it.status === 'fake' ? 'Falsa' : 'Autentica' }, it.status === 'fake' ? '❌' : '✅'),
  );
}
