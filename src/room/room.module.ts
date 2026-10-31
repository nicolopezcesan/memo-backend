import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module.js';
import { RoomRepository } from './room.repository.js';

@Module({
  imports: [RedisModule],
  providers: [RoomRepository],
  exports: [RoomRepository],
})
export class RoomModule {}
