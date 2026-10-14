import { Module } from '@nestjs/common';
import { ChainModule } from '../chain/chain.module';
import { AnonymizeService } from './anonymize.service';
import { AssetsService } from './assets.service';
import { BotService } from './bot.service';
import { DropService } from './drop.service';
import { GameEventsService } from './game-events.service';
import { MechanicsService } from './mechanics.service';
import { GameGateway } from './game.gateway';
import { LeaderboardService } from './leaderboard.service';
import { MarketService } from './market.service';
import { PlayerService } from './player.service';
import { RunService } from './run.service';
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
    RunService,
    LeaderboardService,
    AnonymizeService,
    GameGateway,
  ],
})
export class GameModule {}
