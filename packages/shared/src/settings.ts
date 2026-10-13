// Appiattisce game_config.json nelle righe di `game_settings` (chiavi "economy.market_fee_pct").
// Usato dal seed e dal server all'avvio, così le SP leggono sempre gli stessi numeri del codice TS.

export const SETTING_NAME_MAX = 96;
export const SETTING_VALUE_MAX = 255;

export interface FlatSettings {
  settings: [name: string, value: string][];
  /** Chiavi saltate perché array di oggetti (es. first_run.beats): servono solo al codice TS. */
  skipped: string[];
}

export function flattenSettings(config: object): FlatSettings {
  const out: FlatSettings = { settings: [], skipped: [] };
  walk(config as Record<string, unknown>, '', out);
  return out;
}

function walk(node: Record<string, unknown>, prefix: string, out: FlatSettings): void {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('_')) continue; // note di design, non valori
    const name = prefix ? `${prefix}.${key}` : key;
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.some((v) => typeof v === 'object' && v !== null)) {
        out.skipped.push(name);
        continue;
      }
      push(out, name, JSON.stringify(value));
    } else if (typeof value === 'object') {
      walk(value as Record<string, unknown>, name, out);
    } else if (typeof value === 'boolean') {
      push(out, name, value ? '1' : '0');
    } else {
      push(out, name, String(value));
    }
  }
}

function push(out: FlatSettings, name: string, value: string): void {
  if (name.length > SETTING_NAME_MAX) throw new Error(`game_settings: nome troppo lungo (${name})`);
  if (value.length > SETTING_VALUE_MAX) {
    throw new Error(`game_settings: valore di ${name} oltre ${SETTING_VALUE_MAX} caratteri`);
  }
  out.settings.push([name, value]);
}
