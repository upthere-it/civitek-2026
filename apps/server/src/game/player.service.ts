import { Injectable, Logger } from '@nestjs/common';
import {
  assetViewFromChain,
  perceivedValue,
  wardrobeValue,
  type AssetEventType,
  type AvatarLook,
  type InventoryItem,
} from '@sp/shared';
import { recoverySecret } from '../config/env';
import { GameConfigService } from '../config/game-config.service';
import { DbService } from '../db/db.service';
import { SpError } from '../db/sp-error';
import {
  MAX_RECOVERY_ATTEMPTS,
  deviceHash,
  formatCode,
  randomNickname,
  recoveryCode,
  recoveryHash,
} from './identity';

export interface PlayerRow {
  id: number;
  nickname: string;
  coins: number;
  avatar_skin: number | null;
  avatar_hair: number | null;
  avatar_hair_color: number | null;
  avatar_outfit: number | null;
  recovery_hash: string | null;
}

export interface PlayerState {
  row: PlayerRow;
  look: AvatarLook | null;
  inventory: InventoryItem[];
  wardrobeValue: number;
  shoesColor: string | null;
}

const NICKNAME_ATTEMPTS = 12;

@Injectable()
export class PlayerService {
  private readonly logger = new Logger(PlayerService.name);
  private readonly secret = recoverySecret();

  constructor(
    private readonly db: DbService,
    private readonly cfg: GameConfigService,
  ) {}

  /** Giocatore del device (creato se nuovo, con nickname e codice generati qui). */
  async getOrCreate(deviceId: string): Promise<{ playerId: number; created: boolean }> {
    const { nickname, recovery_code } = this.cfg.player;
    let recoveryAttempt = 0;
    for (let i = 0; i < NICKNAME_ATTEMPTS * 2; i++) {
      // dopo metà tentativi il numero del nickname prende una cifra in più (spazio esaurito)
      const nick = randomNickname(nickname, i >= NICKNAME_ATTEMPTS ? 1 : 0);
      const code = recoveryCode(this.secret, deviceId, recoveryAttempt, recovery_code);
      try {
        const [row] = await this.db.call<{ player_id: number; created: number }>('sp_player_get_or_create', [
          deviceHash(deviceId),
          nick,
          recoveryHash(code),
        ]);
        return { playerId: row.player_id, created: row.created === 1 };
      } catch (err) {
        if (!(err instanceof SpError)) throw err;
        if (err.code === 'NICKNAME_TAKEN' || err.code === 'DEVICE_TAKEN') continue;
        if (err.code === 'RECOVERY_TAKEN' && recoveryAttempt + 1 < MAX_RECOVERY_ATTEMPTS) {
          recoveryAttempt++;
          continue;
        }
        throw err;
      }
    }
    this.logger.error('nessun nickname libero dopo tutti i tentativi');
    throw new SpError('BUSY');
  }

  async setAvatar(playerId: number, look: AvatarLook): Promise<void> {
    await this.db.call('sp_player_set_avatar', [playerId, look.skin, look.hair, look.hairColor, look.outfit]);
  }

  /** Codice da mostrare a questo device, se è quello registrato per il giocatore. */
  displayCode(deviceId: string, storedHash: string | null): string | null {
    if (!storedHash) return null;
    const cfg = this.cfg.player.recovery_code;
    for (let attempt = 0; attempt < MAX_RECOVERY_ATTEMPTS; attempt++) {
      const code = recoveryCode(this.secret, deviceId, attempt, cfg);
      if (recoveryHash(code) === storedHash) return formatCode(code, cfg.display_format);
    }
    return null; // device associato con il codice (M4): il codice lo conosce già chi l'ha digitato
  }

  async loadState(playerId: number): Promise<PlayerState> {
    const [row] = await this.db.select<PlayerRow>(
      `SELECT id, nickname, coins, avatar_skin, avatar_hair, avatar_hair_color, avatar_outfit, recovery_hash
         FROM players WHERE id = ?`,
      [playerId],
    );
    if (!row) throw new SpError('PLAYER_NOT_FOUND');
    const inventory = await this.inventoryOf(playerId);
    let best: InventoryItem | null = null;
    for (const it of inventory) if (!best || it.perceivedValue > best.perceivedValue) best = it;
    return {
      row,
      look: lookOf(row),
      inventory,
      wardrobeValue: wardrobeValue(row.coins, inventory.map((i) => i.perceivedValue)),
      shoesColor: best ? (this.cfg.item(best.itemId)?.palette.upper ?? null) : null,
    };
  }

  /** Scarpe possedute con il valore percepito calcolato da shared (unica implementazione). */
  async inventoryOf(playerId: number): Promise<InventoryItem[]> {
    const assets = await this.db.select<{
      id: number;
      public_id: string;
      item_id: string;
      serial: number;
      is_fake: number;
      fake_revealed: number;
      legend_count: number;
      minted_by: number;
    }>(
      `SELECT id, public_id, item_id, serial, is_fake, fake_revealed, legend_count, minted_by
         FROM assets WHERE owner_id = ? ORDER BY id`,
      [playerId],
    );
    if (!assets.length) return [];
    const links = await this.db.select<{ asset_id: number; event: AssetEventType; to_id: number; is_system: number }>(
      `SELECT ev.asset_id, ev.event, ev.to_id, p.is_system
         FROM asset_events ev JOIN players p ON p.id = ev.to_id
        WHERE ev.asset_id IN (?) ORDER BY ev.asset_id, ev.id`,
      [assets.map((a) => a.id)],
    );
    const treasury = this.cfg.economy.system_players.treasury;
    return assets.map((a) => {
      const chain = links
        .filter((l) => l.asset_id === a.id)
        .map((l) => ({ event: l.event, toId: l.to_id, toIsSystem: l.is_system === 1 }));
      const view = assetViewFromChain(
        { isFake: a.is_fake === 1, fakeRevealed: a.fake_revealed === 1, legendCount: a.legend_count, mintedBy: a.minted_by },
        chain,
        treasury,
      );
      const base = this.cfg.item(a.item_id)?.base_value ?? 0;
      return {
        assetId: a.id,
        publicId: a.public_id,
        itemId: a.item_id,
        serial: a.serial,
        perceivedValue: perceivedValue(view, base, this.cfg.valuation),
      };
    });
  }
}

export function lookOf(row: PlayerRow): AvatarLook | null {
  if (row.avatar_skin === null || row.avatar_hair === null || row.avatar_hair_color === null || row.avatar_outfit === null) {
    return null;
  }
  return { skin: row.avatar_skin, hair: row.avatar_hair, hairColor: row.avatar_hair_color, outfit: row.avatar_outfit };
}
