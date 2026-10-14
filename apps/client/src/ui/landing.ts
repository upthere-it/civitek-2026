import { h, uiRoot } from './dom';
import { T } from './texts';

/** Landing (GAME_DESIGN §2): fondo primary, logo bianco, titolo in Chillax, CTA accent-400. */
export function showLanding(onEnter: () => void): { setProgress: (p: number) => void; setBusy: (busy: boolean) => void; close: () => void } {
  const cta = h('button', { class: 'btn btn-secondary', type: 'button' }, T.landingCta);
  const progress = h('div', { class: 'progress' }, h('div', { class: 'progress-bar' }));
  const el = h(
    'section',
    { class: 'screen landing' },
    h('img', { class: 'logo', src: 'assets/brand/logo_upthere_white.svg', alt: 'Upthere' }),
    h('h1', { class: 'title' }, T.landingTitle),
    cta,
    progress,
    h('a', { class: 'landing-privacy', href: '/privacy/' }, T.privacy),
  );
  let busy = false;
  cta.addEventListener('click', () => {
    if (busy) return;
    onEnter();
  });
  uiRoot().append(el);
  return {
    setProgress(p) {
      (progress.firstChild as HTMLElement).style.width = `${Math.round(p * 100)}%`;
      progress.classList.toggle('done', p >= 1);
    },
    setBusy(b) {
      busy = b;
      cta.disabled = b;
      cta.textContent = b ? T.connecting : T.landingCta;
    },
    close() {
      el.remove();
    },
  };
}
