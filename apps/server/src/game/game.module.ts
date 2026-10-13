import { Module } from '@nestjs/common';
import { ChainModule } from '../chain/chain.module';
import { GameGateway } from './game.gateway';
import { PlayerService } from './player.service';
import { WorldService } from './world.service';

@Module({
  imports: [ChainModule],
  providers: [PlayerService, WorldService, GameGateway],
})
export class GameModule {}
