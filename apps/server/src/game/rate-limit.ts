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
