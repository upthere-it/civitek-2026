import type { Listing } from '@sp/shared';
import type { Api } from '../net/api';
import { RequestError } from '../net/socket';
import { h, toast } from './dom';
import { act, debounce, openPanel, row } from './panel';
import { openPassport } from './passport';
import { shoeIcon, shoeText } from './shoe';
import { isMine, subscribe } from './store';
import { T } from './texts';

/**
 * Bacheca: gli annunci di giocatori e bot. Si compra solo dal passaporto, così la storia della scarpa si
 * guarda sempre prima di pagare (GAME_DESIGN §7).
 */
export function openBoard(api: Api): void {
  const panel = openPanel(T.boardTitle, 'board');
  let listings: Listing[] = [];
  let cursor: number | null = null;

  const render = () => {
    const more = h('button', { class: 'btn btn-secondary', type: 'button' }, T.boardMore);
    more.addEventListener('click', () => void act(more, () => load(cursor ?? undefined)));
    panel.body.replaceChildren(
      h('p', { class: 'panel-summary' }, T.boardHint),
      ...(listings.length ? listings.map(listingRow) : [h('p', { class: 'muted' }, T.boardEmpty)]),
      ...(cursor !== null ? [more] : []),
    );
  };

  const listingRow = (l: Listing): HTMLElement => {
    const sub = isMine(l.sellerId) ? T.boardMine(l.perceivedValue) : T.boardBy(l.sellerName, l.perceivedValue);
    return row(
      [shoeIcon(l.itemId), shoeText(l.itemId, sub)],
      [h('span', { class: 'row-price' }, T.coins(l.price)), h('span', { class: 'row-go', 'aria-hidden': 'true' }, '›')],
      () => openPassport(api, l.assetId),
    );
  };

  /** Senza cursore ricarica la prima pagina; con il cursore aggiunge la successiva. */
  const load = async (from?: number) => {
    const page = await api.marketList(from);
    if (panel.closed) return;
    listings = from === undefined ? page.listings : [...listings, ...page.listings];
    cursor = page.nextCursor;
    render();
  };
  const refresh = debounce(() => {
    if (!panel.closed) load().catch(() => undefined);
  }, 400);

  panel.onClose(subscribe('market', refresh));
  load().catch((err: unknown) => {
    toast(err instanceof RequestError ? err.message : T.genericError);
    panel.close();
  });
}
