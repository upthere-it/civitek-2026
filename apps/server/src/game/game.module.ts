import { Module } from '@nestjs/common';
import { ChainModule } from '../chain/chain.module';
import { AssetsService } from './assets.service';
import { BotService } from './bot.service';
import { DropService } from './drop.service';
import { GameEventsService } from './game-events.service';
import { MechanicsService } from './mechanics.service';
import { GameGateway } from './game.gateway';
import { MarketService } from './market.service';
import { PlayerService } from './player.service';
import { WorldService } from './world.service';

@Module({
  imports: [ChainModule],
  providers: [
    GameEventsService,
    AssetsService,
    PlayerService,
    MarketService,
    WorldService,
    MechanicsService,
    DropService,
    BotService,
    GameGateway,
  ],
})
export class GameModule {}
