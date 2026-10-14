import { RequestError } from '../net/socket';
import { h, toast, uiRoot } from './dom';
import { T } from './texts';

export interface Panel {
  body: HTMLElement;
  /** Barra in fondo per le azioni (Compra, Vendi, …): resta visibile mentre il corpo scorre. */
  foot: HTMLElement;
  close(): void;
  /** Chiamata una volta alla chiusura (×, tap fuori, Esc): qui i pannelli si disiscrivono dagli avvisi. */
  onClose(fn: () => void): void;
  readonly closed: boolean;
}

const open: Panel[] = [];

/** Foglio dal basso sopra il villaggio. Si possono impilare: il passaporto si apre sopra la bacheca. */
export function openPanel(title: string, kind: string): Panel {
  const heading = h('h2', { class: 'panel-title', id: `panel-${kind}-${open.length}` }, title);
  const body = h('div', { class: 'panel-body' });
  const foot = h('div', { class: 'panel-foot' });
  const cleanup: (() => void)[] = [];
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    layer.remove();
    open.splice(open.indexOf(panel), 1);
    for (const fn of cleanup) fn();
  };
  const layer = h(
    'section',
    { class: `panel-layer panel-${kind}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': heading.id },
    h('div', { class: 'panel-backdrop', onclick: close }),
    h(
      'div',
      { class: 'panel' },
      h('header', { class: 'panel-head' }, heading, h('button', { class: 'panel-close', type: 'button', 'aria-label': T.close, onclick: close }, '×')),
      body,
      foot,
    ),
  );
  const panel: Panel = {
    body,
    foot,
    close,
    onClose: (fn) => cleanup.push(fn),
    get closed() {
      return closed;
    },
  };
  open.push(panel);
  uiRoot().append(layer);
  return panel;
}

export const panelsOpen = () => open.length;

addEventListener('keydown', (e) => {
  if (e.key === 'Escape') open.at(-1)?.close();
});

/**
 * Esegue un'azione dal bottone: lo disabilita finché il server non risponde (niente doppi acquisti col doppio
 * tap) e mostra l'errore in italiano che arriva dal server.
 */
export async function act(btn: HTMLButtonElement, fn: () => Promise<void>): Promise<void> {
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    await fn();
  } catch (err) {
    toast(err instanceof RequestError ? err.message : T.genericError);
  } finally {
    btn.disabled = false;
  }
}

/** Riga di una lista con il contenuto a sinistra (tap → dettaglio) e le azioni a destra. */
export function row(main: Node[], side: Node[], onOpen?: () => void): HTMLElement {
  const content = onOpen
    ? h('button', { class: 'row-main', type: 'button', onclick: onOpen }, ...main)
    : h('div', { class: 'row-main' }, ...main);
  return h('div', { class: 'row' }, content, h('div', { class: 'row-side' }, ...side));
}

/** Debounce per i ricarichi da avvisi ravvicinati (la bacheca cambia spesso quando girano i bot). */
export function debounce(fn: () => void, ms: number): () => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return () => {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}
