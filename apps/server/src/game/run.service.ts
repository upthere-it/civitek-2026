import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { GameConfigService } from '../config/game-config.service';
import { DbService } from '../db/db.service';
import { GameEventsService } from './game-events.service';
import { startLoop, stopLoop } from './loop';

/** I beat sono testi a tempo: un controllo al secondo basta. */
const RUN_CHECK_EVERY_MS = 1000;
/** Un beat appena passato si manda lo stesso: copre il "welcome" a 0:00, che parte mentre si entra. */
const BEAT_GRACE_MS = 2000;

interface Tracked {
  startedAt: number;
  /** Indice in first_run.beats del prossimo beat da mandare. */
  next: number;
}

/**
 * Suggerimenti dei primi minuti (GAME_DESIGN §5): i beat di first_run.beats, contati dal primo ingresso nel
 * villaggio (players.first_run_started_at, sull'orologio del DB). Niente timer né obiettivo: dal 14/10 la
 * sfida è la classifica live. A una riconnessione i beat già passati non si ripetono.
 */
@Injectable()
export class RunService implements OnModuleInit, OnModuleDestroy {
  static readonly LOOP = 'first-run';

  private readonly logger = new Logger(RunService.name);
  private readonly tracked = new Map<number, Tracked>();

  constructor(
    private readonly db: DbService,
    private readonly cfg: GameConfigService,
    private readonly events: GameEventsService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    startLoop(this.scheduler, RunService.LOOP, RUN_CHECK_EVERY_MS, async () => this.tick(), this.logger);
  }

  onModuleDestroy(): void {
    stopLoop(this.scheduler, RunService.LOOP);
  }

  /** Ingresso nel villaggio (connessione o avatar appena creato): la prima volta segna l'inizio. */
  async enter(playerId: number, wardrobeValue: number, now = Date.now()): Promise<void> {
    const [row] = await this.db.call<{ started_ms: number }>('sp_run_start', [playerId, wardrobeValue]);
    const startedAt = Number(row.started_ms);
    const beats = this.cfg.config.first_run.beats;
    const next = beats.findIndex((b) => startedAt + b.at_sec * 1000 >= now - BEAT_GRACE_MS);
    if (next < 0) this.tracked.delete(playerId);
    else this.tracked.set(playerId, { startedAt, next });
  }

  leave(playerId: number): void {
    this.tracked.delete(playerId);
  }

  /** Un giro: i beat scaduti ai giocatori seguiti; chi li ha visti tutti non si segue più. */
  tick(now = Date.now()): void {
    const beats = this.cfg.config.first_run.beats;
    for (const [playerId, t] of this.tracked) {
      while (t.next < beats.length && t.startedAt + beats[t.next].at_sec * 1000 <= now) {
        this.events.emit({ type: 'run.beat', playerId, beatId: beats[t.next].id });
        t.next++;
      }
      if (t.next >= beats.length) this.tracked.delete(playerId);
    }
  }
}
