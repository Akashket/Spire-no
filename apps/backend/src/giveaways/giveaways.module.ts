import { Module } from '@nestjs/common';
import { GiveawaysService } from './giveaways.service';
import { GiveawaysController } from './giveaways.controller';
import { RandomnessService } from './randomness.service';

@Module({
  providers: [GiveawaysService, RandomnessService],
  controllers: [GiveawaysController],
})
export class GiveawaysModule {}
