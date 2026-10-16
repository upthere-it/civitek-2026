import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ChainModule } from './chain/chain.module';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { GameModule } from './game/game.module';

@Module({
  imports: [ScheduleModule.forRoot(), ConfigModule, DbModule, ChainModule, GameModule],
})
export class AppModule {}
