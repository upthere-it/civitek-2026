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

export function toast(text: string, ms = 2600): void {
  const el = h('div', { class: 'toast', role: 'status' }, text);
  uiRoot().append(el);
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 400);
}
