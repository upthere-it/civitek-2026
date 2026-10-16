import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { GameConfigService } from '../config/game-config.service';
import { DbService } from '../db/db.service';
import { startLoop, stopLoop } from './loop';

/**
 * Anonimizzazione dei giocatori inattivi (CLAUDE.md regola 6): ogni player.anonymize_every_min chiama
 * sp_anonymize_inactive a blocchi di player.anonymize_batch finché ne trova. Gli utenti sono minorenni: dopo
 * player.inactivity_anonymize_days senza connessioni non resta niente che li ricolleghi al personaggio.
 */
@Injectable()
export class AnonymizeService implements OnModuleInit, OnModuleDestroy {
  static readonly LOOP = 'anonymize';

  private readonly logger = new Logger(AnonymizeService.name);

  constructor(
    private readonly db: DbService,
    private readonly cfg: GameConfigService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    startLoop(this.scheduler, AnonymizeService.LOOP, this.cfg.player.anonymize_every_min * 60_000, () => this.tick(), this.logger);
  }

  onModuleDestroy(): void {
    stopLoop(this.scheduler, AnonymizeService.LOOP);
  }

  /** Un giro: restituisce quanti giocatori ha anonimizzato. */
  async tick(): Promise<number> {
    const { inactivity_anonymize_days: days, anonymize_batch: batch } = this.cfg.player;
    let total = 0;
    for (;;) {
      const [row] = await this.db.call<{ anonymized: number }>('sp_anonymize_inactive', [days, batch]);
      const n = Number(row?.anonymized ?? 0);
      total += n;
      if (n < batch) break;
    }
    if (total) this.logger.log(`anonimizzati ${total} giocatori inattivi da ${days} giorni`);
    return total;
  }
}
