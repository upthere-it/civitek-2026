/** Token bucket per socket: player.rate_limit_actions_per_sec azioni al secondo, con picco uguale. */
export class RateLimiter {
  private tokens: number;
  private last = Date.now();

  constructor(private readonly perSec: number) {
    this.tokens = perSec;
  }

  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.perSec, this.tokens + ((now - this.last) / 1000) * this.perSec);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/**
 * Tentativi di recupero col codice (GAME_DESIGN §14): finestre di un minuto, per IP e in tutto il server.
 * Il limite per IP è largo perché una classe intera esce dallo stesso NAT; quello globale tiene lento chi
 * provasse i codici a tappeto.
 */
export class RecoverLimiter {
  private window = 0;
  private global = 0;
  private readonly byIp = new Map<string, number>();

  constructor(
    private readonly perIpPerMin: number,
    private readonly globalPerMin: number,
  ) {}

  take(ip: string, now = Date.now()): boolean {
    const window = Math.floor(now / 60_000);
    if (window !== this.window) {
      this.window = window;
      this.global = 0;
      this.byIp.clear();
    }
    const n = this.byIp.get(ip) ?? 0;
    if (n >= this.perIpPerMin || this.global >= this.globalPerMin) return false;
    this.byIp.set(ip, n + 1);
    this.global++;
    return true;
  }
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * IP del client. Dietro nginx (connessione da loopback) è l'ultimo indirizzo di X-Forwarded-For, quello che
 * aggiunge nginx stesso: i precedenti li può scrivere chiunque.
 */
export function clientIp(address: string, forwardedFor: string | string[] | undefined): string {
  if (!LOOPBACK.has(address) || !forwardedFor) return address;
  const header = Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor;
  return header.split(',').map((s) => s.trim()).filter(Boolean).at(-1) ?? address;
}
