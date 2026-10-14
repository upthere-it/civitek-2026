import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { runTarget, type RunReveal, type RunState } from '@sp/shared';
import { GameConfigService } from '../config/game-config.service';
import { DbService } from '../db/db.service';
import { SpError } from '../db/sp-error';
import { GameEventsService } from './game-events.service';
import { startLoop, stopLoop } from './loop';
import { PlayerService } from './player.service';

/** I beat sono testi a tempo: un controllo al secondo basta. */
const RUN_CHECK_EVERY_MS = 1000;
/** Un beat appena passato si manda lo stesso: copre il "welcome" a 0:00, che parte mentre si entra. */
const BEAT_GRACE_MS = 2000;

interface Tracked {
  startedAt: number;
  /** Indice in first_run.beats del prossimo beat da mandare. */
  next: number;
  ending: boolean;
}

interface RunRow {
  started_ms: number | null;
  start_value: number | null;
  completed: number;
  merchant: number;
}

/**
 * Prima run (GAME_DESIGN §5): parte all'ingresso nel villaggio e dura first_run.duration_sec sull'orologio del
 * server, anche a telefono spento. Ai giocatori connessi manda i beat (`run.beat`) e alla fine il reveal
 * (`run.end`). Chi non era connesso alla fine riceve il reveal appena rientra.
 */
@Injectable()
export class RunService implements OnModuleInit, OnModuleDestroy {
  static readonly LOOP = 'first-run';

  private readonly logger = new Logger(RunService.name);
  private readonly tracked = new Map<number, Tracked>();

  constructor(
    private readonly db: DbService,
    private readonly cfg: GameConfigService,
    private readonly players: PlayerService,
    private readonly events: GameEventsService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    startLoop(this.scheduler, RunService.LOOP, RUN_CHECK_EVERY_MS, () => this.tick(), this.logger);
  }

  onModuleDestroy(): void {
    stopLoop(this.scheduler, RunService.LOOP);
  }

  /**
   * Ingresso nel villaggio (connessione o avatar appena creato): avvia la run se è la prima volta e segue il
   * giocatore per i beat. I beat già passati non si ripetono a una riconnessione.
   */
  async enter(playerId: number, wardrobeValue: number, now = Date.now()): Promise<RunState> {
    const [row] = await this.db.call<RunRow>('sp_run_start', [playerId, wardrobeValue]);
    const state = this.stateOf(row);
    if (!state.completed) {
      const beats = this.cfg.config.first_run.beats;
      let next = beats.findIndex((b) => state.startedAt + b.at_sec * 1000 >= now - BEAT_GRACE_MS);
      if (next < 0) next = beats.length;
      this.tracked.set(playerId, { startedAt: state.startedAt, next, ending: false });
    }
    return state;
  }

  leave(playerId: number): void {
    this.tracked.delete(playerId);
  }

  /** Stato della run per state.init, senza avviarla (null se non è mai partita). */
  async state(playerId: number): Promise<RunState | null> {
    const [row] = await this.db.select<RunRow>(
      `SELECT ROUND(UNIX_TIMESTAMP(first_run_started_at) * 1000) AS started_ms, first_run_start_value AS start_value,
              first_run_completed_at IS NOT NULL AS completed, first_run_merchant AS merchant
         FROM players WHERE id = ?`,
      [playerId],
    );
    return row && row.started_ms !== null ? this.stateOf(row) : null;
  }

  /** Un giro: beat scaduti ai giocatori seguiti, reveal a chi ha finito. */
  async tick(now = Date.now()): Promise<void> {
    const { beats, duration_sec } = this.cfg.config.first_run;
    const ends: number[] = [];
    for (const [playerId, t] of this.tracked) {
      const endsAt = t.startedAt + duration_sec * 1000;
      // i beat dal tempo della fine in poi ("reveal") sono la fine stessa: li fa run.end
      while (t.next < beats.length && beats[t.next].at_sec < duration_sec && t.startedAt + beats[t.next].at_sec * 1000 <= now) {
        this.events.emit({ type: 'run.beat', playerId, beatId: beats[t.next].id });
        t.next++;
      }
      if (now >= endsAt && !t.ending) ends.push(playerId);
    }
    for (const playerId of ends) await this.complete(playerId);
  }

  /** Chiude la run: valore finale, badge "Mercante", reveal al giocatore. */
  async complete(playerId: number): Promise<RunReveal | null> {
    const t = this.tracked.get(playerId);
    if (t) t.ending = true;
    try {
      const { wardrobeValue } = await this.players.loadState(playerId);
      const [current] = await this.db.select<{ start_value: number | null }>(
        'SELECT first_run_start_value AS start_value FROM players WHERE id = ?',
        [playerId],
      );
      const target = runTarget(current?.start_value ?? 0, this.cfg.config.first_run.objective.multiplier);
      await this.db.call('sp_run_complete', [playerId, wardrobeValue, wardrobeValue >= target ? 1 : 0]);
      this.tracked.delete(playerId);
      const reveal = await this.reveal(playerId);
      this.events.emit({ type: 'run.end', playerId, reveal });
      return reveal;
    } catch (err) {
      // RUN_NOT_OVER: l'orologio del DB è un filo indietro rispetto a quello del server, si riprova al giro dopo
      if (t) t.ending = false;
      if (!(err instanceof SpError && err.code === 'RUN_NOT_OVER')) this.logger.error(`fine run di ${playerId}: ${String(err)}`);
      return null;
    }
  }

  /** Dati del reveal (GAME_DESIGN §12), ricalcolati dal DB: si possono rivedere quando si vuole. */
  async reveal(playerId: number): Promise<RunReveal> {
    // la giornata va dall'inizio della run al reveal (chi era offline alla fine lo riceve quando rientra)
    const [row] = await this.db.select<{
      start_value: number;
      end_value: number;
      merchant: number;
      trades: number;
      fakes_bought: number;
      fakes_spotted: number;
    }>(
      `SELECT p.first_run_start_value AS start_value, p.first_run_end_value AS end_value, p.first_run_merchant AS merchant,
              (SELECT COUNT(*) FROM asset_events ev
                WHERE ev.event = 'TRANSFER' AND (ev.from_id = p.id OR ev.to_id = p.id)
                  AND ev.created_at >= p.first_run_started_at
                  AND ev.created_at <= p.first_run_completed_at) AS trades,
              (SELECT COUNT(*) FROM asset_events ev JOIN assets a ON a.id = ev.asset_id
                WHERE ev.event = 'TRANSFER' AND ev.to_id = p.id AND a.is_fake = 1
                  AND ev.created_at >= p.first_run_started_at
                  AND ev.created_at <= p.first_run_completed_at) AS fakes_bought,
              (SELECT COUNT(*) FROM coin_ledger l JOIN assets a ON a.id = l.ref_id
                WHERE l.reason = 'AUTH' AND l.from_id = p.id AND a.is_fake = 1
                  AND l.created_at >= p.first_run_started_at
                  AND l.created_at <= p.first_run_completed_at) AS fakes_spotted
         FROM players p
        WHERE p.id = ? AND p.first_run_completed_at IS NOT NULL`,
      [playerId],
    );
    if (!row) throw new SpError('RUN_NOT_FINISHED');

    const { inventory } = await this.players.loadState(playerId);
    let best: (typeof inventory)[number] | null = null;
    for (const it of inventory) if (!best || it.perceivedValue > best.perceivedValue) best = it;
    let owners = 0;
    if (best) {
      const [o] = await this.db.select<{ owners: number }>(
        "SELECT COUNT(DISTINCT to_id) AS owners FROM asset_events WHERE asset_id = ? AND event IN ('MINT', 'FAKE_MINT', 'TRANSFER')",
        [best.assetId],
      );
      owners = Number(o?.owners ?? 1);
    }
    return {
      startValue: row.start_value,
      endValue: row.end_value,
      target: runTarget(row.start_value, this.cfg.config.first_run.objective.multiplier),
      merchant: row.merchant === 1,
      trades: Number(row.trades),
      fakesBought: Number(row.fakes_bought),
      fakesSpotted: Number(row.fakes_spotted),
      best: best ? { assetId: best.assetId, itemId: best.itemId, owners } : null,
      recoveryCode: null,
    };
  }

  private stateOf(row: RunRow): RunState {
    const { duration_sec, objective } = this.cfg.config.first_run;
    const startedAt = Number(row.started_ms);
    const startValue = row.start_value ?? 0;
    return {
      startedAt,
      endsAt: startedAt + duration_sec * 1000,
      startValue,
      target: runTarget(startValue, objective.multiplier),
      completed: Number(row.completed) === 1,
      merchant: Number(row.merchant) === 1,
    };
  }
}
