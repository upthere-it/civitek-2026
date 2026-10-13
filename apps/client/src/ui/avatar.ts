import type { AvatarLook } from '@sp/shared';
import { gameConfig } from '../config';
import { h, uiRoot } from './dom';
import { T } from './texts';

/** Schermata avatar (GAME_DESIGN §3): tre tratti in una sola schermata, anteprima live, poi "Entra". */
export function showAvatarPicker(
  initial: AvatarLook,
  onChange: (look: AvatarLook) => void,
  onConfirm: (look: AvatarLook) => Promise<void>,
): { close: () => void; previewBox: () => { top: number; bottom: number } } {
  const a = gameConfig.avatar;
  const look = { ...initial };

  const swatches = (label: string, colors: string[], key: keyof AvatarLook) => {
    const row = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': label });
    colors.forEach((color, i) => {
      const b = h('button', {
        class: 'swatch',
        type: 'button',
        role: 'radio',
        'aria-label': `${label} ${i + 1}`,
        style: `--c:${color}`,
      });
      b.addEventListener('click', () => {
        look[key] = i;
        refresh();
      });
      row.append(b);
    });
    return row;
  };

  const styles = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': T.avatarHair });
  a.hair_styles.forEach((style, i) => {
    const b = h('button', { class: 'chip', type: 'button', role: 'radio' }, T.hairStyles[style] ?? style);
    b.addEventListener('click', () => {
      look.hair = i;
      refresh();
    });
    styles.append(b);
  });

  const skin = swatches(T.avatarSkin, a.skin_tones, 'skin');
  const hairColor = swatches(T.avatarHair, a.hair_colors, 'hairColor');
  const outfit = swatches(T.avatarOutfit, a.outfit_colors, 'outfit');
  const cta = h('button', { class: 'btn btn-primary', type: 'button' }, T.avatarCta);

  const title = h('h1', { class: 'title avatar-title' }, T.avatarTitle);
  const sheet = h(
    'div',
    { class: 'sheet' },
    h('h2', {}, T.avatarSkin),
      skin,
      h('h2', {}, T.avatarHair),
      styles,
      hairColor,
    h('h2', {}, T.avatarOutfit),
    outfit,
    cta,
  );
  const el = h('section', { class: 'screen avatar' }, title, sheet);

  function mark(row: HTMLElement, index: number) {
    [...row.children].forEach((c, i) => c.setAttribute('aria-checked', String(i === index)));
  }
  function refresh() {
    mark(skin, look.skin);
    mark(styles, look.hair);
    mark(hairColor, look.hairColor);
    mark(outfit, look.outfit);
    onChange({ ...look });
  }

  cta.addEventListener('click', async () => {
    cta.disabled = true;
    try {
      await onConfirm({ ...look });
    } finally {
      cta.disabled = false;
    }
  });

  uiRoot().append(el);
  refresh();
  return {
    close: () => el.remove(),
    /** Spazio libero tra titolo e pannello, dove il canvas disegna l'anteprima. */
    previewBox: () => ({ top: title.getBoundingClientRect().bottom, bottom: sheet.getBoundingClientRect().top }),
  };
}
