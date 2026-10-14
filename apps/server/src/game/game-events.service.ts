import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { DropInfo, LeaderboardRow } from '@sp/shared';

/** Cose successe fuori da una richiesta (loop di bot, bancarella, drop, MC Suola, suggerimenti, classifica): il gateway le inoltra. */
export type GameEvent =
  | { type: 'market' }
  | { type: 'stall' }
  | { type: 'players'; ids: number[] }
  | { type: 'asset'; assetId: number }
  | { type: 'legend.returned'; assetId: number; ownerId: number }
  | { type: 'drop.announce'; drop: DropInfo }
  | { type: 'drop.update'; dropId: number; sold: number }
  | { type: 'drop.closed'; dropId: number; nextAt: number }
  | { type: 'run.beat'; playerId: number; beatId: string }
  | { type: 'leaderboard'; rows: LeaderboardRow[] };

@Injectable()
export class GameEventsService {
  private readonly events = new Subject<GameEvent>();
  readonly events$: Observable<GameEvent> = this.events.asObservable();

  emit(e: GameEvent): void {
    this.events.next(e);
  }
}
