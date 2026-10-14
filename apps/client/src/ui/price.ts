import { marketFee } from '@sp/shared';
import { gameConfig } from '../config';
import { h } from './dom';
import { act } from './panel';
import { T } from './texts';

/**
 * Scelta del prezzo per mettere una scarpa in bacheca. I limiti arrivano dal server (maxListPrice) e il server
 * li ricontrolla: qui servono solo a non far sbagliare il giocatore.
 */
export function pricePicker(value: number, max: number, onConfirm: (price: number) => Promise<void>): HTMLElement {
  const min = gameConfig.economy.listing_min_price;
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n) || min));
  let price = clamp(value);

  const input = h('input', {
    class: 'price-input',
    type: 'number',
    inputmode: 'numeric',
    min: String(min),
    max: String(max),
    'aria-label': T.priceLabel,
  });
  const hint = h('p', { class: 'price-hint' });
  const set = (n: number) => {
    price = clamp(n);
    input.value = String(price);
    const fee = marketFee(price, gameConfig.economy);
    hint.textContent = T.priceHint(value, price - fee, fee);
  };
  input.addEventListener('input', () => {
    const n = Number(input.value);
    if (Number.isFinite(n) && n >= min && n <= max) set(n);
  });
  input.addEventListener('change', () => set(Number(input.value)));
  set(price);

  const step = (d: number) => h('button', { class: 'step', type: 'button', 'aria-label': d < 0 ? T.less : T.more, onclick: () => set(price + d) }, d < 0 ? '−' : '+');
  const presets = T.pricePresets.map(([label, k]) => h('button', { class: 'chip', type: 'button', onclick: () => set(value * k) }, label));
  const confirm = h('button', { class: 'btn btn-primary', type: 'button' }, T.listCta);
  confirm.addEventListener('click', () => void act(confirm, () => onConfirm(clamp(Number(input.value)))));

  return h(
    'div',
    { class: 'price-picker' },
    h('div', { class: 'stepper' }, step(-1), input, step(1)),
    h('div', { class: 'chips' }, ...presets),
    hint,
    confirm,
  );
}
