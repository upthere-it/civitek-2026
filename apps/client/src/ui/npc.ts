import { npcByZone } from '../config';

/** Battuta a caso di un NPC (npcs.json), con i segnaposto {chiave} sostituiti. */
export function npcLine(zone: string, key: string, vars: Record<string, string | number> = {}): string | null {
  const lines = npcByZone.get(zone)?.lines[key] ?? [];
  if (!lines.length) return null;
  const line = lines[crypto.getRandomValues(new Uint32Array(1))[0] % lines.length];
  return line.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export const npcName = (zone: string) => npcByZone.get(zone)?.name ?? zone;
