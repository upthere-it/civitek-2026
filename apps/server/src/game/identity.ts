import { createHash, createHmac, randomInt } from 'node:crypto';
import type { PlayerCfg } from '@sp/shared';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** device_id = UUID v4 casuale generato dal client. Niente fingerprinting: solo questo formato. */
export function isDeviceId(v: unknown): v is string {
  return typeof v === 'string' && UUID_V4.test(v);
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Il device_id in chiaro non si salva: nel DB c'è solo sha256(device_id minuscolo). */
export const deviceHash = (deviceId: string) => sha256(deviceId.toLowerCase());

/** Nickname dal pattern di config (es. "{animal}{number}" → "Lince42"). Non modificabile dal giocatore. */
export function randomNickname(cfg: PlayerCfg['nickname'], extraDigits = 0): string {
  const digits = cfg.number_digits + extraDigits;
  const animal = cfg.animals[randomInt(cfg.animals.length)];
  const number = String(randomInt(10 ** digits)).padStart(digits, '0');
  return cfg.pattern.replace('{animal}', animal).replace('{number}', number);
}

/**
 * Codice di recupero ricavato dal device: HMAC(segreto del server, device_id). Il DB ne tiene solo l'hash,
 * ma il server può sempre mostrarlo al device che l'ha generato (reveal, profilo) senza salvarlo.
 * `attempt` cambia il codice solo nel caso rarissimo di collisione con un altro giocatore.
 */
export function recoveryCode(secret: string, deviceId: string, attempt: number, cfg: PlayerCfg['recovery_code']): string {
  const alphabet = cfg.alphabet;
  const limit = 256 - (256 % alphabet.length); // rejection sampling: niente bias del modulo
  let out = '';
  for (let block = 0; out.length < cfg.length; block++) {
    const bytes = createHmac('sha256', secret).update(`${deviceId.toLowerCase()}:${attempt}:${block}`).digest();
    for (const b of bytes) {
      if (b < limit && out.length < cfg.length) out += alphabet[b % alphabet.length];
    }
  }
  return out;
}

/** Normalizza ciò che digita il giocatore ("abc-234" → "ABC234") prima di farne l'hash. */
export const normalizeCode = (code: string) => code.toUpperCase().replace(/[^0-9A-Z]/g, '');

export const recoveryHash = (code: string) => sha256(normalizeCode(code));

/** "ABC234" → "ABC-234" secondo display_format. */
export function formatCode(code: string, format: string): string {
  let i = 0;
  return format.replace(/X/g, () => code[i++] ?? '');
}

export const MAX_RECOVERY_ATTEMPTS = 4;
