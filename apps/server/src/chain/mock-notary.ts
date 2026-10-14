import { randomInt } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { ChainCfg } from '@sp/shared';
import { batchHash, type ChainNotary, type NotarizeItem, type NotaryHealth } from './chain-notary';

/**
 * Notary di sviluppo (default finché D1 non è chiusa): aspetta un ritardo casuale tra
 * chain.mock.min_delay_ms e max_delay_ms e restituisce `mock-<sha256 del payload>`.
 */
export class MockNotary implements ChainNotary {
  readonly network = 'mock';

  constructor(private readonly cfg: ChainCfg['mock']) {
    if (cfg.min_delay_ms < 0 || cfg.max_delay_ms < cfg.min_delay_ms) {
      throw new Error('chain.mock: serve 0 <= min_delay_ms <= max_delay_ms');
    }
  }

  async notarizeBatch(items: NotarizeItem[]): Promise<{ txHash: string }> {
    const delay = randomInt(this.cfg.min_delay_ms, this.cfg.max_delay_ms + 1);
    if (delay > 0) await sleep(delay);
    return { txHash: `mock-${batchHash(items)}` };
  }

  explorerUrl(): string {
    return '';
  }

  async health(): Promise<NotaryHealth> {
    return { ok: true, network: this.network, detail: 'mock: nessuna transazione vera' };
  }
}
