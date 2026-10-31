import { Module } from '@nestjs/common';
import { RoomModule } from '../room/room.module.js';
import { GameService } from './game.service.js';

@Module({
  imports: [RoomModule],
  providers: [GameService],
  exports: [GameService],
})
export class GameModule {}
