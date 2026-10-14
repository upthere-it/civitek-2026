import { npcByZone } from '../config';
import { h } from './dom';
import { openPanel } from './panel';
import { T } from './texts';

/**
 * Enoteca DOP Digital (GAME_DESIGN §15): lo stesso passaporto delle scarpe, per una bottiglia demo. Tutti gli
 * anelli certificati, etichettata "ESEMPIO DIMOSTRATIVO", in fondo "Scopri DOP Digital". Niente da comprare.
 */
export function openEnoteca(npcLine: string | null): void {
  const bottle = npcByZone.get('enoteca')?.demo_bottle;
  const panel = openPanel(T.wineTitle, 'enoteca');
  if (npcLine) panel.body.append(h('p', { class: 'npc-line' }, npcLine));
  if (!bottle) return;

  const chain = h('ol', { class: 'chain' });
  for (const step of bottle.timeline) {
    chain.append(
      h(
        'li',
        { class: `ring ${step.certified ? 'ring-confirmed' : 'ring-none'}` },
        h('span', { class: 'ring-dot', 'aria-hidden': 'true' }),
        h(
          'div',
          { class: 'ring-body' },
          h('p', { class: 'ring-text' }, step.step),
          h('p', { class: 'ring-meta' }, step.detail),
          ...(step.certified ? [h('p', { class: 'ring-meta' }, h('span', { class: 'cert cert-ok' }, T.wineCertified))] : []),
        ),
      ),
    );
  }
  panel.body.append(
    h(
      'div',
      { class: 'pp-head' },
      h('span', { class: 'wine-icon', 'aria-hidden': 'true' }, '🍷'),
      h('div', { class: 'pp-id' }, h('h3', { class: 'pp-name' }, bottle.name), h('p', { class: 'pp-value' }, h('span', { class: 'badge badge-demo' }, bottle.label))),
    ),
    chain,
    h('p', { class: 'pp-footer' }, T.wineFooter),
  );
  panel.foot.append(h('a', { class: 'btn btn-secondary', href: bottle.cta.url, target: '_blank', rel: 'noopener noreferrer' }, bottle.cta.text));
}
