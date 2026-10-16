import { randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import {
  advance,
  findPath,
  nearestWalkable,
  parseVillage,
  type Facing,
  type PlayerProfile,
  type PlayerSnapshot,
  type Point,
  type TiledMap,
  type Village,
  type WorldPlayers,
} from '@sp/shared';
import { REPO_ROOT } from '../config/env';
import { GameConfigService } from '../config/game-config.service';

interface WorldPlayer {
  id: number;
  x: number;
  y: number;
  path: Point[];
  facing: Facing;
  moving: boolean;
  profile: PlayerProfile;
  /** Versione del profilo: se cambia (es. colore scarpe) si rimanda a chi lo vede già. */
  profileRev: number;
  /** Cresce a ogni partenza e a ogni arrivo: solo allora gli spettatori ricevono qualcosa. */
  motionRev: number;
}

interface Seen {
  motionRev: number;
  profileRev: number;
}

/**
 * Presenza nel villaggio, in memoria (PM2 fork, 1 istanza). Il server simula il movimento lungo lo stesso
 * percorso che calcola il client (findPath di shared) e manda a ciascuno solo chi è nel suo raggio.
 */
@Injectable()
export class WorldService {
  readonly village: Village;
  private readonly players = new Map<number, WorldPlayer>();
  /** per spettatore: cosa gli abbiamo già mandato */
  private readonly seen = new Map<number, Map<number, Seen>>();

  constructor(private readonly cfg: GameConfigService) {
    const file = join(REPO_ROOT, 'apps', 'client', 'public', cfg.config.world.map);
    this.village = parseVillage(JSON.parse(readFileSync(file, 'utf8')) as TiledMap);
  }

  get size(): number {
    return this.players.size;
  }

  has(id: number): boolean {
    return this.players.has(id);
  }

  position(id: number): Point | null {
    const p = this.players.get(id);
    return p ? { x: p.x, y: p.y } : null;
  }

  /** Entra (o rientra) nel villaggio allo spawn, con un piccolo scarto per non sovrapporsi. */
  join(id: number, profile: PlayerProfile): Point {
    const existing = this.players.get(id);
    if (existing) {
      existing.profile = profile;
      existing.profileRev++;
      return { x: existing.x, y: existing.y };
    }
    const { spawn, grid } = this.village;
    const jitter = () => randomInt(-grid.tile, grid.tile + 1);
    const start = nearestWalkable(grid, { x: spawn.x + jitter(), y: spawn.y + jitter() }) ?? spawn;
    this.players.set(id, { id, x: start.x, y: start.y, path: [], facing: 'down', moving: false, profile, profileRev: 0, motionRev: 0 });
    this.seen.set(id, new Map());
    return { x: start.x, y: start.y };
  }

  leave(id: number): void {
    this.players.delete(id);
    this.seen.delete(id);
  }

  updateProfile(id: number, profile: Partial<PlayerProfile>): void {
    const p = this.players.get(id);
    if (!p) return;
    p.profile = { ...p.profile, ...profile };
    p.profileRev++;
  }

  /** Imposta la destinazione. Restituisce il punto finale effettivo, o null se irraggiungibile. */
  moveTo(id: number, target: Point): Point | null {
    const p = this.players.get(id);
    if (!p) return null;
    const path = findPath(this.village.grid, p, target);
    if (!path) return null;
    p.path = path;
    p.moving = path.length > 0;
    p.motionRev++;
    return path.length ? path[path.length - 1] : { x: p.x, y: p.y };
  }

  /** Avanza tutti i giocatori di dtSec secondi. */
  step(dtSec: number): void {
    const dist = this.cfg.config.world.walk_speed_px_s * dtSec;
    for (const p of this.players.values()) {
      if (!p.moving) continue;
      p.moving = advance(p, dist);
      if (!p.moving) p.motionRev++; // arrivato: lo si comunica una volta
    }
  }

  /** Delta per uno spettatore: chi è entrato o cambiato nel suo raggio, chi ne è uscito. */
  deltaFor(viewerId: number, t: number): WorldPlayers | null {
    const viewer = this.players.get(viewerId);
    const seen = this.seen.get(viewerId);
    if (!viewer || !seen) return null;
    const r2 = this.cfg.config.world.visible_radius_px ** 2;
    const players: PlayerSnapshot[] = [];
    const visible = new Set<number>();

    for (const p of this.players.values()) {
      if (p.id !== viewerId && (p.x - viewer.x) ** 2 + (p.y - viewer.y) ** 2 > r2) continue;
      visible.add(p.id);
      const prev = seen.get(p.id);
      const profileChanged = !prev || prev.profileRev !== p.profileRev;
      if (prev && !profileChanged && prev.motionRev === p.motionRev) continue;
      players.push({
        id: p.id,
        x: Math.round(p.x),
        y: Math.round(p.y),
        facing: p.facing,
        moving: p.moving,
        ...(p.moving ? { path: p.path.map((q): [number, number] => [Math.round(q.x), Math.round(q.y)]) } : {}),
        ...(profileChanged ? { profile: p.profile } : {}),
      });
      seen.set(p.id, { motionRev: p.motionRev, profileRev: p.profileRev });
    }
    const gone: number[] = [];
    for (const id of seen.keys()) {
      if (!visible.has(id)) {
        gone.push(id);
        seen.delete(id);
      }
    }
    return players.length || gone.length ? { t, players, gone } : null;
  }

  /** Giocatori nel raggio di `id` (lui compreso): destinatari di un'emote. */
  nearby(id: number): number[] {
    const me = this.players.get(id);
    if (!me) return [];
    const r2 = this.cfg.config.world.visible_radius_px ** 2;
    return [...this.players.values()].filter((p) => (p.x - me.x) ** 2 + (p.y - me.y) ** 2 <= r2).map((p) => p.id);
  }

  ids(): number[] {
    return [...this.players.keys()];
  }
}
