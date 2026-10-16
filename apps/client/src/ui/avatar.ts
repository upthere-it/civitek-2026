import { nicknameFormatError, normalizeNickname, suggestNickname, type AvatarLook } from '@sp/shared';
import { gameConfig } from '../config';
import { h, uiRoot } from './dom';
import { T } from './texts';

export interface AvatarPicker {
  close(): void;
  /** Spazio libero tra titolo e pannello, dove il canvas disegna l'anteprima. */
  previewBox(): { top: number; bottom: number };
  /** Errore sul nome arrivato dal server (già preso, vietato): torna al primo passo e lo mostra. */
  nameError(message: string): void;
}

const randInt = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;

/**
 * Creazione del personaggio (GAME_DESIGN §3) in due passi, con l'anteprima live sempre visibile:
 * 1. chi sei: stile (ragazzo/ragazza) e nome, proposto dal gioco e modificabile solo qui (D12);
 * 2. il look: pelle, capelli, felpa. Poi "Entra".
 */
export function showAvatarPicker(
  initial: AvatarLook,
  initialName: string,
  onChange: (look: AvatarLook) => void,
  onConfirm: (look: AvatarLook, nickname: string) => Promise<void>,
): AvatarPicker {
  const a = gameConfig.avatar;
  const rules = gameConfig.player.nickname;
  const look = { ...initial };

  // ------------------------------------------------------------------ passo 1: chi sei
  const bodies = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': T.avatarBody });
  a.body_types.forEach((type, i) => {
    const b = h('button', { class: 'chip', type: 'button', role: 'radio' }, T.bodyTypes[type] ?? type);
    b.addEventListener('click', () => {
      look.body = i;
      refresh();
    });
    bodies.append(b);
  });

  const name = h('input', {
    class: 'name-input',
    type: 'text',
    value: initialName,
    maxlength: String(rules.max_length),
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    enterkeyhint: 'next',
    'aria-label': T.avatarName,
    'aria-describedby': 'name-hint',
  });
  const dice = h('button', { class: 'dice', type: 'button', 'aria-label': T.avatarNameDice, title: T.avatarNameDice }, '🎲');
  const hint = h('p', { class: 'name-hint', id: 'name-hint' }, T.avatarNameHint);
  const error = h('p', { class: 'name-error', role: 'alert' });
  const next = h('button', { class: 'btn btn-primary', type: 'button' }, T.avatarNext);

  const checkName = (): string | null => {
    const value = normalizeNickname(name.value);
    const bad = nicknameFormatError(value, rules);
    error.textContent = bad ? T.nicknameRules(rules.min_length, rules.max_length) : '';
    name.setAttribute('aria-invalid', String(!!bad));
    return bad ? null : value;
  };
  name.addEventListener('input', () => {
    if (error.textContent) checkName();
  });
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') next.click();
  });
  dice.addEventListener('click', () => {
    name.value = suggestNickname(rules, randInt);
    checkName();
  });
  next.addEventListener('click', () => {
    if (checkName()) step(2);
  });

  const step1 = h(
    'div',
    { class: 'avatar-step' },
    h('h2', {}, T.avatarBody),
    bodies,
    h('h2', {}, T.avatarName),
    h('div', { class: 'name-row' }, name, dice),
    error,
    hint,
    next,
  );

  // ------------------------------------------------------------------ passo 2: il look
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

  // acconciature dello stile scelto (avatar.hair_by_body): cambiano quando si cambia stile
  const styles = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': T.avatarHair });
  const hairOptions = () => a.hair_by_body[a.body_types[look.body]] ?? a.hair_styles.map((_, i) => i);
  let hairFor = -1;
  const renderStyles = () => {
    if (hairFor === look.body) return;
    hairFor = look.body;
    const options = hairOptions();
    if (!options.includes(look.hair)) look.hair = options[0];
    styles.replaceChildren(
      ...options.map((i) => {
        const style = a.hair_styles[i];
        const b = h('button', { class: 'chip', type: 'button', role: 'radio', 'data-hair': String(i) }, T.hairStyles[style] ?? style);
        b.addEventListener('click', () => {
          look.hair = i;
          refresh();
        });
        return b;
      }),
    );
  };

  const skin = swatches(T.avatarSkin, a.skin_tones, 'skin');
  const hairColor = swatches(T.avatarHair, a.hair_colors, 'hairColor');
  const outfit = swatches(T.avatarOutfit, a.outfit_colors, 'outfit');
  const back = h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => step(1) }, T.avatarBack);
  const cta = h('button', { class: 'btn btn-primary', type: 'button' }, T.avatarCta);

  const step2 = h(
    'div',
    { class: 'avatar-step', hidden: true },
    h('h2', {}, T.avatarSkin),
    skin,
    h('h2', {}, T.avatarHair),
    styles,
    hairColor,
    h('h2', {}, T.avatarOutfit),
    outfit,
    h('div', { class: 'avatar-step-actions' }, back, cta),
  );

  const title = h('h1', { class: 'title avatar-title' }, T.avatarWho);
  const sheet = h('div', { class: 'sheet' }, step1, step2);
  const el = h('section', { class: 'screen avatar' }, title, sheet);

  function step(n: 1 | 2) {
    step1.hidden = n !== 1;
    step2.hidden = n !== 2;
    title.textContent = n === 1 ? T.avatarWho : T.avatarLookTitle;
    // il pannello cambia altezza: l'anteprima si risistema (resize lo ascolta main.ts)
    requestAnimationFrame(() => dispatchEvent(new Event('resize')));
  }

  function mark(row: HTMLElement, index: number) {
    [...row.children].forEach((c, i) => c.setAttribute('aria-checked', String(i === index)));
  }
  function refresh() {
    renderStyles();
    mark(bodies, look.body);
    mark(skin, look.skin);
    [...styles.children].forEach((c) => c.setAttribute('aria-checked', String((c as HTMLElement).dataset.hair === String(look.hair))));
    mark(hairColor, look.hairColor);
    mark(outfit, look.outfit);
    onChange({ ...look });
  }

  cta.addEventListener('click', async () => {
    const nickname = checkName();
    if (!nickname) return step(1);
    cta.disabled = true;
    try {
      await onConfirm({ ...look }, nickname);
    } finally {
      cta.disabled = false;
    }
  });

  uiRoot().append(el);
  refresh();
  return {
    close: () => el.remove(),
    previewBox: () => ({ top: title.getBoundingClientRect().bottom, bottom: sheet.getBoundingClientRect().top }),
    nameError(message: string) {
      step(1);
      error.textContent = message;
      name.setAttribute('aria-invalid', 'true');
      name.focus();
    },
  };
}
