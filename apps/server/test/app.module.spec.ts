// Il modulo Nest si avvia davvero: DI (decorator metadata con ts-jest), sync di game_settings, worker.
import type { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { ChainEventsService } from '../src/chain/chain-events.service';
import { ChainWorker } from '../src/chain/chain.worker';
import { DbService } from '../src/db/db.service';
import { SettingsSyncService } from '../src/db/settings-sync.service';
import { cfg } from './helpers/db';

describe('AppModule', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(() => app.close());

  it('risolve il worker della chain e registra il suo intervallo', () => {
    expect(app.get(ChainWorker)).toBeInstanceOf(ChainWorker);
    expect(app.get(ChainEventsService)).toBeInstanceOf(ChainEventsService);
    expect(app.get(SchedulerRegistry).doesExist('interval', ChainWorker.INTERVAL)).toBe(true);
  });

  it('allinea game_settings a game_config.json all’avvio', async () => {
    const db = app.get(DbService);
    await db.select("UPDATE game_settings SET value = '99' WHERE name = 'economy.market_fee_pct'");
    await app.get(SettingsSyncService).onModuleInit(); // come a un riavvio del server
    const [row] = await db.select<{ value: string }>("SELECT value FROM game_settings WHERE name = 'economy.market_fee_pct'");
    expect(row.value).toBe(String(cfg.economy.market_fee_pct));
  });
});
