type Attrs = Record<string, string | boolean | ((e: Event) => void)>;

/** Piccolo helper per costruire l'overlay HTML senza framework. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, '').toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false) el.setAttribute(k, v);
  }
  el.append(...children);
  return el;
}

export const uiRoot = () => document.getElementById('ui')!;

/** Avvisi impilati in basso: due toast ravvicinati (es. "è tornata" e "Hai venduto") non si coprono. */
function toastStack(): HTMLElement {
  let stack = document.getElementById('toasts');
  if (!stack) {
    stack = h('div', { id: 'toasts', class: 'toasts', 'aria-live': 'polite' });
    uiRoot().append(stack);
  }
  return stack;
}

export function toast(text: string, ms = 2600): void {
  const el = h('div', { class: 'toast', role: 'status' }, text);
  toastStack().append(el);
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 400);
}

/** Banner in alto (drop, beat della prima run), impilati sotto l'HUD: due insieme non si coprono. */
export function bannerStack(): HTMLElement {
  let stack = document.getElementById('banners');
  if (!stack) {
    stack = h('div', { id: 'banners', class: 'banners' });
    uiRoot().append(stack);
  }
  return stack;
}
