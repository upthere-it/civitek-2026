import { Injectable, Logger } from '@nestjs/common';
import {
  listingPriceRange,
  nicknameFormatError,
  normalizeNickname,
  wardrobeValue,
  type AvatarLook,
  type InventoryItem,
} from '@sp/shared';
import { recoverySecret } from '../config/env';
import { GameConfigService } from '../config/game-config.service';
import { DbService } from '../db/db.service';
import { SpError } from '../db/sp-error';
import { AssetsService } from './assets.service';
import { NicknameFilter } from './nickname-filter';
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
  avatar_body: number | null;
  avatar_skin: number | null;
  avatar_hair: number | null;
  avatar_hair_color: number | null;
  avatar_outfit: number | null;
  recovery_hash: string | null;
  legend_ready_ms: number | null;
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
  private readonly filter = NicknameFilter.fromRepo();

  constructor(
    private readonly db: DbService,
    private readonly cfg: GameConfigService,
    private readonly assets: AssetsService,
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

  /**
   * Creazione del personaggio: aspetto e nome (D12). Il nome è quello proposto dal gioco o uno scelto dal
   * giocatore; qui si ricontrollano formato e parole vietate, la SP ricontrolla lunghezza e unicità.
   */
  async setProfile(playerId: number, look: AvatarLook, rawNickname: string | null): Promise<string> {
    const [current] = await this.db.select<{ nickname: string }>('SELECT nickname FROM players WHERE id = ?', [playerId]);
    if (!current) throw new SpError('PLAYER_NOT_FOUND');
    // l'acconciatura deve essere tra quelle dello stile scelto (avatar.hair_by_body); gli indici li valida la SP
    const { body_types, hair_by_body } = this.cfg.config.avatar;
    const allowed = hair_by_body[body_types[look.body] ?? ''];
    if (allowed && !allowed.includes(look.hair)) throw new SpError('AVATAR_INVALID');
    const nickname = rawNickname === null ? current.nickname : normalizeNickname(rawNickname);
    if (nickname !== current.nickname) {
      const format = nicknameFormatError(nickname, this.cfg.player.nickname);
      if (format) throw new SpError(format);
      if (this.filter.isBlocked(nickname)) throw new SpError('NICKNAME_BLOCKED');
    }
    const [row] = await this.db.call<{ nickname: string }>('sp_player_set_profile', [
      playerId,
      nickname,
      look.body,
      look.skin,
      look.hair,
      look.hairColor,
      look.outfit,
    ]);
    return row.nickname;
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
      `SELECT id, nickname, coins, avatar_body, avatar_skin, avatar_hair, avatar_hair_color, avatar_outfit, recovery_hash,
              ROUND(UNIX_TIMESTAMP(legend_ready_at) * 1000) AS legend_ready_ms
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

  /** Scarpe possedute, con valore percepito (AssetsService) e l'eventuale annuncio aperto. */
  async inventoryOf(playerId: number): Promise<InventoryItem[]> {
    const assets = await this.db.select<{
      id: number;
      public_id: string;
      item_id: string;
      serial: number;
      fake_revealed: number;
      auth_verified: number;
      legend_count: number;
      locked_ms: number | null;
    }>(
      `SELECT id, public_id, item_id, serial, fake_revealed, auth_verified, legend_count,
              ROUND(UNIX_TIMESTAMP(locked_until) * 1000) AS locked_ms
         FROM assets WHERE owner_id = ? ORDER BY id`,
      [playerId],
    );
    if (!assets.length) return [];
    const values = await this.assets.values(assets.map((a) => a.id));
    const listings = await this.db.select<{ id: number; asset_id: number; price: number }>(
      "SELECT id, asset_id, price FROM market_listings WHERE seller_id = ? AND status = 'OPEN'",
      [playerId],
    );
    return assets.map((a) => {
      const value = values.get(a.id) ?? 0;
      const listing = listings.find((l) => l.asset_id === a.id);
      return {
        assetId: a.id,
        publicId: a.public_id,
        itemId: a.item_id,
        serial: a.serial,
        perceivedValue: value,
        listingId: listing?.id ?? null,
        listingPrice: listing?.price ?? null,
        maxListPrice: listingPriceRange(value, this.cfg.economy).max,
        // is_fake non esce mai: il falso si vede solo quando la Dott.ssa Hash l'ha smascherato
        status: a.fake_revealed === 1 ? 'fake' : a.auth_verified === 1 ? 'authentic' : null,
        lockedUntil: a.locked_ms === null ? null : Number(a.locked_ms),
        legendCount: a.legend_count,
      };
    });
  }
}

export function lookOf(row: PlayerRow): AvatarLook | null {
  if (row.avatar_skin === null || row.avatar_hair === null || row.avatar_hair_color === null || row.avatar_outfit === null) {
    return null;
  }
  // avatar creati prima dello stile (009): ragazzo
  return {
    body: row.avatar_body ?? 0,
    skin: row.avatar_skin,
    hair: row.avatar_hair,
    hairColor: row.avatar_hair_color,
    outfit: row.avatar_outfit,
  };
}
