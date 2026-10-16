import { Global, Module } from '@nestjs/common';
import { GameConfigService } from './game-config.service';

@Global()
@Module({
  providers: [{ provide: GameConfigService, useFactory: () => GameConfigService.fromRepo() }],
  exports: [GameConfigService],
})
export class ConfigModule {}
