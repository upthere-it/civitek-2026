import { Global, Module } from '@nestjs/common';
import { DB_POOL, DbService } from './db.service';
import { createDbPool } from './pool';
import { SettingsSyncService } from './settings-sync.service';

@Global()
@Module({
  providers: [{ provide: DB_POOL, useFactory: () => createDbPool() }, DbService, SettingsSyncService],
  exports: [DbService],
})
export class DbModule {}
