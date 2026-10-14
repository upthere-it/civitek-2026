import { listingPriceRange, type ChainStatus, type Passport, type PassportEvent } from '@sp/shared';
import { gameConfig } from '../config';
import type { Api } from '../net/api';
import { RequestError } from '../net/socket';
import { h, toast } from './dom';
import { act, debounce, openPanel } from './panel';
import { pricePicker } from './price';
import { shoeColorway, shoeIcon, shoeName } from './shoe';
import { isMine, serverNow, store, subscribe } from './store';
import { T } from './texts';

/** Un anello della timeline: LEGEND_IN e LEGEND_OUT si mostrano come uno solo (GAME_DESIGN §7). */
interface Ring {
  id: number;
  event: PassportEvent['event'];
  text: string;
  status: ChainStatus;
  explorerUrl: string | null;
  at: number;
  hash: string;
}

const STATUS_WEIGHT: Record<ChainStatus, number> = { CONFIRMED: 0, NONE: 1, SENDING: 2, PENDING: 2, FAILED: 3 };

/** Passaporto di una scarpa, anche non tua: si apre prima di comprare, ed è questa la lezione. */
export function openPassport(api: Api, assetId: number): void {
  const panel = openPanel(T.passportTitle, 'passport');
  panel.body.append(h('p', { class: 'muted' }, T.loadingPassport));
  const certified = new Map<number, ChainStatus>();
  let footKey = '';

  const load = async () => {
    try {
      const p = await api.passport(assetId);
      if (panel.closed) return;
      panel.body.replaceChildren(...header(p), chain(p, certified), h('p', { class: 'pp-footer' }, T.passportFooter));
      // la barra delle azioni si ricostruisce solo se cambia proprietario o annuncio: una certificazione che
      // arriva mentre si sceglie il prezzo non deve chiudere il selettore
      const locked = isLocked(p);
      const key = `${p.ownerId}|${p.listing?.listingId ?? ''}|${p.stallPrice ?? ''}|${locked}`;
      if (key !== footKey) {
        footKey = key;
        panel.foot.replaceChildren(...actions(api, p, locked, reload));
      }
    } catch (err) {
      toast(err instanceof RequestError ? err.message : T.genericError);
      panel.close();
    }
  };
  const reload = debounce(() => void load(), 200);
  panel.onClose(subscribe('asset', (id) => id === assetId && reload()));
  panel.onClose(subscribe('inventory', reload));
  void load();
}

const isLocked = (p: Passport) => p.lockedUntil !== null && p.lockedUntil > serverNow();

function header(p: Passport): HTMLElement[] {
  const serial =
    p.origin === 'upthere' && p.dropSerial && p.dropQuantity ? T.serialDrop(p.dropSerial, p.dropQuantity) : T.serial(p.serial);
  const status =
    p.status === 'authentic'
      ? h('span', { class: 'badge badge-ok' }, T.statusAuthentic)
      : p.status === 'fake'
        ? h('span', { class: 'badge badge-fake' }, T.statusFake)
        : null;
  const out = [
    h(
      'div',
      { class: 'pp-head' },
      shoeIcon(p.itemId, true),
      h(
        'div',
        { class: 'pp-id' },
        h('h3', { class: 'pp-name' }, shoeName(p.itemId)),
        h('p', { class: 'pp-sub' }, `${shoeColorway(p.itemId)} · ${serial}`),
        h('p', { class: 'pp-value' }, T.valueLine(p.perceivedValue), ...(status ? [' ', status] : [])),
      ),
    ),
    h('p', { class: 'pp-owner' }, isMine(p.ownerId) ? T.ownerYou : T.owner(p.ownerName)),
  ];
  if (isLocked(p)) out.push(h('p', { class: 'pp-owner muted' }, `${T.atLegend}. ${T.lockedLegend}`));
  return out;
}

function rings(p: Passport): Ring[] {
  const who = (id: number, name: string) => (isMine(id) ? T.you : name);
  const out: Ring[] = [];
  for (const e of p.events) {
    const base = { id: e.id, event: e.event, status: e.chainStatus, explorerUrl: e.explorerUrl, at: e.at, hash: e.hash };
    const to = who(e.toId, e.toName);
    switch (e.event) {
      case 'MINT': {
        let text: string;
        if (p.origin === 'upthere') {
          text = T.ringMintUpthere(to) + (p.dropSerial && p.dropQuantity ? T.ringDrop(p.dropSerial, p.dropQuantity) : '');
        } else if (p.origin === 'shop') {
          // prezzo 0 a un umano = regalo di benvenuto; a un bot è una scorta del Negozio
          text = e.price === 0 && !e.toSystem ? T.ringGift(to) : T.ringMintShop(to);
        } else {
          text = T.ringMintOther(to);
        }
        out.push({ ...base, text });
        break;
      }
      case 'FAKE_MINT':
        out.push({ ...base, text: T.ringFake });
        break;
      case 'TRANSFER':
        out.push({ ...base, text: T.ringTransfer(to, e.price) });
        break;
      case 'LEGEND_IN':
        out.push({ ...base, text: T.ringLegend });
        break;
      case 'LEGEND_OUT': {
        const prev = out.at(-1);
        if (prev?.event === 'LEGEND_IN') {
          if (STATUS_WEIGHT[e.chainStatus] > STATUS_WEIGHT[prev.status]) prev.status = e.chainStatus;
          prev.explorerUrl = prev.status === 'CONFIRMED' ? (e.explorerUrl ?? prev.explorerUrl) : null;
          prev.hash = e.hash;
        } else {
          out.push({ ...base, text: T.ringLegend });
        }
        break;
      }
    }
  }
  return out;
}

function chain(p: Passport, seen: Map<number, ChainStatus>): HTMLElement {
  const now = serverNow();
  const list = h('ol', { class: 'chain' });
  for (const r of rings(p)) {
    const badge = certBadge(r);
    const li = h(
      'li',
      { class: `ring ring-${r.status.toLowerCase()}${r.event === 'FAKE_MINT' ? ' ring-unknown' : ''}` },
      h('span', { class: 'ring-dot', 'aria-hidden': 'true' }),
      h(
        'div',
        { class: 'ring-body' },
        h('p', { class: 'ring-text' }, r.text),
        h('p', { class: 'ring-meta' }, badge, ` · ${T.ago(Math.max(0, Math.round((now - r.at) / 1000)))}`),
        h('p', { class: 'ring-hash' }, `${T.hashLabel} ${r.hash.slice(0, 12)}…`),
      ),
    );
    // ⏳ → ✅ mentre il passaporto è aperto: l'anello lampeggia una volta
    const before = seen.get(r.id);
    if (r.status === 'CONFIRMED' && before !== undefined && before !== 'CONFIRMED') li.classList.add('just-certified');
    seen.set(r.id, r.status);
    list.append(li);
  }
  return list;
}

function certBadge(r: Ring): HTMLElement {
  switch (r.status) {
    case 'CONFIRMED':
      return r.explorerUrl
        ? h('a', { class: 'cert cert-ok', href: r.explorerUrl, target: '_blank', rel: 'noopener noreferrer' }, T.certConfirmed)
        : h('span', { class: 'cert cert-ok' }, T.certConfirmed);
    case 'FAILED':
      return h('span', { class: 'cert cert-warn' }, T.certFailed);
    case 'NONE':
      return h('span', { class: 'cert cert-warn' }, T.certNone);
    default:
      return h('span', { class: 'cert cert-pending' }, T.certPending);
  }
}

function actions(api: Api, p: Passport, locked: boolean, reload: () => void): HTMLElement[] {
  const stall = p.stallPrice;
  if (stall !== null) {
    const buy = h('button', { class: 'btn btn-primary', type: 'button' }, T.stallBuyFor(stall));
    buy.addEventListener('click', () =>
      void act(buy, async () => {
        await api.stallBuy(p.assetId);
        toast(T.stallBought(shoeName(p.itemId)));
        reload();
      }),
    );
    return [buy];
  }
  const l = p.listing;
  if (l && !isMine(l.sellerId)) {
    const buy = h('button', { class: 'btn btn-primary', type: 'button' }, T.buyFor(l.price));
    buy.addEventListener('click', () =>
      void act(buy, async () => {
        await api.listingBuy(l.listingId);
        toast(T.bought);
        reload();
      }),
    );
    return [buy];
  }
  if (l) {
    const cancel = h('button', { class: 'btn btn-secondary', type: 'button' }, T.unlistCta);
    cancel.addEventListener('click', () =>
      void act(cancel, async () => {
        await api.listingCancel(l.listingId);
        toast(T.unlisted);
        reload();
      }),
    );
    return [cancel];
  }
  if (isMine(p.ownerId) && !locked) {
    const { max } = listingPriceRange(p.perceivedValue, gameConfig.economy);
    const picker = pricePicker(p.perceivedValue, max, async (price) => {
      await api.listingCreate(p.assetId, price);
      toast(T.listed);
      reload();
    });
    picker.hidden = true;
    const sell = h('button', { class: 'btn btn-secondary', type: 'button' }, T.sell);
    sell.addEventListener('click', () => {
      picker.hidden = false;
      sell.hidden = true;
    });
    return [sell, picker];
  }
  return [];
}
