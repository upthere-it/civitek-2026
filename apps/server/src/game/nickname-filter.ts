import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../config/env';

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

/** Forma di confronto: minuscole, senza accenti, leet → lettere, solo a-z, lettere ripetute ridotte a una. */
export function canonical(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[013457@$]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-z]/g, '')
    .replace(/(.)\1+/g, '$1');
}

/**
 * Filtro dei nomi scelti dai giocatori (D12): data/nickname_blocklist.json, solo lato server.
 * Non è perfetto (nessun filtro di parole lo è): è una rete di sicurezza, insieme a lunghezza, caratteri ammessi
 * e all'invito a non usare il proprio nome vero.
 */
export class NicknameFilter {
  private readonly contains: string[];
  private readonly exact: Set<string>;

  constructor(list: { contiene: string[]; esatte: string[] }) {
    this.contains = list.contiene.map(canonical).filter(Boolean);
    this.exact = new Set(list.esatte.map(canonical));
  }

  static fromRepo(): NicknameFilter {
    return new NicknameFilter(JSON.parse(readFileSync(join(REPO_ROOT, 'data', 'nickname_blocklist.json'), 'utf8')));
  }

  isBlocked(name: string): boolean {
    const c = canonical(name);
    return this.exact.has(c) || this.contains.some((w) => c.includes(w));
  }
}
