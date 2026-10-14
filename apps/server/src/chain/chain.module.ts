import { Module } from '@nestjs/common';
import { GameConfigService } from '../config/game-config.service';
import { CHAIN_NOTARY } from './chain-notary';
import { ChainEventsService } from './chain-events.service';
import { ChainWorker } from './chain.worker';
import { ChainController } from './chain.controller';
import { createNotary } from './notary.factory';

@Module({
  controllers: [ChainController],
  providers: [
    { provide: CHAIN_NOTARY, useFactory: (cfg: GameConfigService) => createNotary(cfg.config), inject: [GameConfigService] },
    ChainEventsService,
    ChainWorker,
  ],
  exports: [ChainEventsService],
})
export class ChainModule {}
