import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { GameConfigService } from '../config/game-config.service';
import { DbService } from '../db/db.service';
import { CHAIN_NOTARY, type ChainNotary } from './chain-notary';
import { ChainEventsService } from './chain-events.service';

interface ClaimedRow {
  id: number;
  hash: string;
}

interface ConfirmedRow {
  event_id: number;
  asset_id: number;
  from_id: number | null;
  to_id: number;
  chain_tx: string;
}

/**
 * Outbox → ChainNotary. La blockchain non sta mai nel percorso critico: lo scambio è valido al COMMIT
 * della SP, la certificazione arriva dopo, da qui. Un solo batch in volo alla volta.
 */
@Injectable()
export class ChainWorker implements OnModuleInit, OnModuleDestroy {
  static readonly INTERVAL = 'chain-worker';

  private readonly logger = new Logger(ChainWorker.name);
  private running = false;
  /** Batch già notarizzato ma non ancora marcato CONFIRMED (DB non raggiungibile): si riprova al giro dopo. */
  private unconfirmed: { batchId: string; txHash: string } | null = null;

  constructor(
    private readonly db: DbService,
    @Inject(CHAIN_NOTARY) private readonly notary: ChainNotary,
    private readonly events: ChainEventsService,
    private readonly cfg: GameConfigService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  async onModuleInit(): Promise<void> {
    const [row] = await this.db.call<{ recovered: number }>('sp_chain_recover_sending');
    if (row?.recovered) this.logger.warn(`${row.recovered} eventi rimasti SENDING rimessi in coda`);

    const { enabled, batch_interval_ms } = this.cfg.chain;
    if (!enabled) {
      this.logger.warn('certificazione disattivata (chain.enabled = false)');
      return;
    }
    const handle = setInterval(() => {
      this.tick().catch((err: unknown) => this.logger.error(`giro del worker fallito: ${String(err)}`));
    }, batch_interval_ms);
    this.scheduler.addInterval(ChainWorker.INTERVAL, handle);
    this.logger.log(`notary "${this.notary.network}", un batch ogni ${batch_interval_ms} ms`);
  }

  onModuleDestroy(): void {
    if (this.scheduler.doesExist('interval', ChainWorker.INTERVAL)) this.scheduler.deleteInterval(ChainWorker.INTERVAL);
  }

  /** Un giro dell'outbox. Restituisce quanti eventi sono passati a CONFIRMED. */
  async tick(): Promise<number> {
    if (this.running || !this.cfg.chain.enabled) return 0;
    this.running = true;
    try {
      let confirmed = 0;
      if (this.unconfirmed) confirmed += await this.confirm(this.unconfirmed.batchId, this.unconfirmed.txHash);

      const { max_items_per_batch, max_attempts } = this.cfg.chain;
      const batchId = randomUUID();
      const rows = await this.db.call<ClaimedRow>('sp_chain_claim_batch', [max_items_per_batch, batchId]);
      if (!rows.length) return confirmed;

      let txHash: string;
      try {
        ({ txHash } = await this.notary.notarizeBatch(rows.map((r) => ({ eventId: r.id, hash: r.hash }))));
      } catch (err) {
        const [res] = await this.db.call<{ failed: number }>('sp_chain_mark_failed', [
          batchId,
          String(err).slice(0, 255),
          max_attempts,
        ]);
        this.logger.warn(
          `batch di ${rows.length} eventi non notarizzato${res?.failed ? ` (${res.failed} ora FAILED)` : ''}: ${String(err)}`,
        );
        return confirmed;
      }
      return confirmed + (await this.confirm(batchId, txHash));
    } finally {
      this.running = false;
    }
  }

  private async confirm(batchId: string, txHash: string): Promise<number> {
    let rows: ConfirmedRow[];
    try {
      rows = await this.db.call<ConfirmedRow>('sp_chain_mark_confirmed', [batchId, txHash]);
    } catch (err) {
      this.unconfirmed = { batchId, txHash };
      throw err;
    }
    this.unconfirmed = null;
    const explorerUrl = this.notary.explorerUrl(txHash);
    this.events.publish(
      rows.map((r) => ({
        assetId: r.asset_id,
        eventId: r.event_id,
        txHash: r.chain_tx,
        explorerUrl,
        fromId: r.from_id,
        toId: r.to_id,
      })),
    );
    return rows.length;
  }
}
