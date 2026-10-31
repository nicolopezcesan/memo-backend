import { Module } from '@nestjs/common';
import { GameModule } from '../game/game.module.js';
import { RoomModule } from '../room/room.module.js';
import { SessionModule } from '../session/session.module.js';
import { GameGateway } from './game.gateway.js';

@Module({
  imports: [RoomModule, SessionModule, GameModule],
  providers: [GameGateway],
})
export class GameGatewayModule {}
