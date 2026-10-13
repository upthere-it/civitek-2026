import { Module } from '@nestjs/common';
import { GameConfigService } from '../config/game-config.service';
import { CHAIN_NOTARY } from './chain-notary';
import { ChainEventsService } from './chain-events.service';
import { ChainWorker } from './chain.worker';
import { createNotary } from './mock-notary';

@Module({
  providers: [
    { provide: CHAIN_NOTARY, useFactory: (cfg: GameConfigService) => createNotary(cfg.chain), inject: [GameConfigService] },
    ChainEventsService,
    ChainWorker,
  ],
  exports: [ChainEventsService],
})
export class ChainModule {}
