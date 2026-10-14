import type { RunReveal } from '@sp/shared';
import { gameConfig } from '../config';
import type { Api } from '../net/api';
import { h, uiRoot } from './dom';
import { passportView } from './passport';
import { T } from './texts';

let open: HTMLElement | null = null;

/**
 * Reveal di fine prima run (GAME_DESIGN §12), il momento da mostrare anche sul palco. Schermata scrollabile:
 * la giornata in numeri, il passaporto della scarpa più preziosa, il ponte verso DOP Digital, il codice di
 * recupero, "Continua a giocare". `knownCode` è il codice digitato su questo telefono, se si è rientrati con quello.
 */
export function showReveal(api: Api, r: RunReveal, knownCode: string | null): void {
  open?.remove();
  const code = r.recoveryCode ?? knownCode;
  const close = () => {
    el.remove();
    if (open === el) open = null;
  };

  const passport = h('div', { class: 'reveal-passport' }, h('p', { class: 'muted' }, T.loadingPassport));
  if (r.best) {
    api
      .passport(r.best.assetId)
      .then((p) => passport.replaceChildren(...passportView(p)))
      .catch(() => passport.remove());
  }

  const el = h(
    'section',
    { class: 'screen reveal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'reveal-title' },
    h(
      'div',
      { class: 'reveal-inner' },
      h('h1', { class: 'title', id: 'reveal-title' }, T.revealTitle),
      h(
        'div',
        { class: 'reveal-card' },
        h('p', { class: 'reveal-values' }, T.revealValues(r.startValue, r.endValue)),
        r.merchant
          ? h('p', { class: 'reveal-badge' }, T.revealMerchant, h('span', {}, T.revealMerchantHint(r.target)))
          : h('p', { class: 'muted' }, T.revealMissed(r.target)),
        h('p', { class: 'reveal-stats' }, `${T.revealTrades(r.trades)} · ${T.revealFakes(r.fakesBought, r.fakesSpotted)}`),
      ),
      ...(r.best ? [h('h2', { class: 'reveal-h2' }, T.revealBestTitle), passport] : []),
      h(
        'div',
        { class: 'reveal-card reveal-bridge' },
        h('p', {}, r.best ? T.revealBridge(r.best.owners) : T.revealBridgeNone),
        h('a', { class: 'btn btn-secondary', href: gameConfig.links.dop_digital, target: '_blank', rel: 'noopener noreferrer' }, T.revealCtaDop),
      ),
      h(
        'div',
        { class: 'reveal-card reveal-code' },
        h('h2', { class: 'reveal-h2' }, T.revealCodeTitle),
        ...(code
          ? [h('p', { class: 'code' }, code), h('p', { class: 'muted' }, T.revealCodeHint)]
          : [h('p', { class: 'muted' }, T.revealCodeUnknown)]),
      ),
      h('button', { class: 'btn btn-secondary reveal-continue', type: 'button', onclick: close }, T.revealContinue),
    ),
  );
  open = el;
  uiRoot().append(el);
}

export const revealOpen = () => open !== null;
