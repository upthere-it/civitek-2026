import { gameConfig } from '../config';
import { h, uiRoot } from './dom';
import { T } from './texts';

export interface Landing {
  setProgress(p: number): void;
  setBusy(busy: boolean): void;
  /** Il server ha rifiutato il codice: lo si mostra sotto il campo e si può riprovare. */
  recoverError(message: string): void;
  close(): void;
}

/**
 * Landing (GAME_DESIGN §2): fondo primary, logo bianco, titolo in Chillax, CTA accent-400. Sotto, "Hai già
 * giocato?" apre il campo per il codice di recupero (§14): si entra con quello invece di creare un giocatore.
 */
export function showLanding(onEnter: (recoverCode?: string) => void): Landing {
  const cta = h('button', { class: 'btn btn-secondary', type: 'button' }, T.landingCta);
  const progress = h('div', { class: 'progress' }, h('div', { class: 'progress-bar' }));
  const { length, display_format } = gameConfig.player.recovery_code;

  const toggle = h('button', { class: 'link', type: 'button' }, T.landingRecover);
  const code = h('input', {
    class: 'code-input',
    type: 'text',
    inputmode: 'text',
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: 'false',
    enterkeyhint: 'go',
    maxlength: String(display_format.length + 2),
    placeholder: display_format,
    'aria-label': T.recoverLabel,
  });
  const recoverCta = h('button', { class: 'btn btn-secondary', type: 'button' }, T.recoverCta);
  const error = h('p', { class: 'name-error', role: 'alert' });
  const back = h('button', { class: 'link', type: 'button' }, T.recoverBack);
  const form = h('div', { class: 'recover', hidden: true }, code, error, recoverCta, back);

  const el = h(
    'section',
    { class: 'screen landing' },
    h('img', { class: 'logo', src: 'assets/brand/logo_upthere_white.svg', alt: 'Upthere' }),
    h('h1', { class: 'title' }, T.landingTitle),
    cta,
    toggle,
    form,
    progress,
  );
  let busy = false;

  const recovering = (on: boolean) => {
    form.hidden = !on;
    cta.hidden = on;
    toggle.hidden = on;
    error.textContent = '';
    if (on) code.focus();
  };
  const submit = () => {
    if (busy) return;
    const typed = code.value.toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (typed.length !== length) {
      error.textContent = T.recoverFormat(length, display_format);
      return;
    }
    error.textContent = '';
    onEnter(typed);
  };

  cta.addEventListener('click', () => {
    if (!busy) onEnter();
  });
  toggle.addEventListener('click', () => recovering(true));
  back.addEventListener('click', () => recovering(false));
  recoverCta.addEventListener('click', submit);
  code.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
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
      recoverCta.disabled = b;
      cta.textContent = b ? T.connecting : T.landingCta;
      recoverCta.textContent = b ? T.connecting : T.recoverCta;
    },
    recoverError(message) {
      recovering(true);
      error.textContent = message;
    },
    close() {
      el.remove();
    },
  };
}
