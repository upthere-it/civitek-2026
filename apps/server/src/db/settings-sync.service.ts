import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { flattenSettings } from '@sp/shared';
import { GameConfigService } from '../config/game-config.service';
import { DbService } from './db.service';

/**
 * All'avvio riscrive game_settings da game_config.json: le SP leggono sempre gli stessi numeri del
 * codice TS, anche se la config è cambiata dopo l'ultimo seed (es. durante la taratura).
 */
@Injectable()
export class SettingsSyncService implements OnModuleInit {
  private readonly logger = new Logger(SettingsSyncService.name);

  constructor(
    private readonly db: DbService,
    private readonly cfg: GameConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const { settings } = flattenSettings(this.cfg.config);
    const changed = await this.db.replaceSettings(settings);
    this.logger.log(`game_settings: ${settings.length} chiavi${changed ? `, ${changed} cambiate rispetto al DB` : ''}`);
  }
}
