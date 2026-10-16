import type { PlayerCfg } from './config';

type NicknameCfg = PlayerCfg['nickname'];

/** Il nome come lo salva il server: spazi ai bordi tolti, forma Unicode NFC (una "è" è sempre lo stesso carattere). */
export function normalizeNickname(raw: string): string {
  return raw.normalize('NFC').trim();
}

/**
 * Lunghezza e caratteri ammessi (config player.nickname). Il client la usa per l'avviso immediato, il server
 * la riapplica sempre, insieme alla lista di parole vietate che il client non conosce.
 */
export function nicknameFormatError(name: string, cfg: NicknameCfg): 'NICKNAME_INVALID' | null {
  const len = [...name].length;
  if (len < cfg.min_length || len > cfg.max_length) return 'NICKNAME_INVALID';
  return new RegExp(cfg.allowed_pattern, 'u').test(name) ? null : 'NICKNAME_INVALID';
}

/** Nome proposto dal gioco (pattern di config, es. "Lince42"). `randInt(n)` restituisce un intero in [0, n). */
export function suggestNickname(cfg: NicknameCfg, randInt: (n: number) => number, extraDigits = 0): string {
  const digits = cfg.number_digits + extraDigits;
  const animal = cfg.animals[randInt(cfg.animals.length)];
  const number = String(randInt(10 ** digits)).padStart(digits, '0');
  return cfg.pattern.replace('{animal}', animal).replace('{number}', number);
}
