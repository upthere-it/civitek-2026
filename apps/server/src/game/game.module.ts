import { Module } from '@nestjs/common';
import { ChainModule } from '../chain/chain.module';
import { AssetsService } from './assets.service';
import { GameGateway } from './game.gateway';
import { MarketService } from './market.service';
import { PlayerService } from './player.service';
import { WorldService } from './world.service';

@Module({
  imports: [ChainModule],
  providers: [AssetsService, PlayerService, MarketService, WorldService, GameGateway],
})
export class GameModule {}
