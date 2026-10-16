import { createHash, randomInt } from 'node:crypto';
import { suggestNickname, type PlayerCfg } from '@sp/shared';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** device_id = UUID v4 casuale generato dal client. Niente fingerprinting: solo questo formato. */
export function isDeviceId(v: unknown): v is string {
  return typeof v === 'string' && UUID_V4.test(v);
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Il device_id in chiaro non si salva: nel DB c'è solo sha256(device_id minuscolo). */
export const deviceHash = (deviceId: string) => sha256(deviceId.toLowerCase());

/** Nickname proposto dal pattern di config (es. "{animal}{number}" → "Lince42"); il giocatore può cambiarlo solo alla creazione. */
export function randomNickname(cfg: PlayerCfg['nickname'], extraDigits = 0): string {
  return suggestNickname(cfg, randomInt, extraDigits);
}
