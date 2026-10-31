import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  @Get()
  async check() {
    try {
      await this.redis.ping();
    } catch {
      throw new ServiceUnavailableException('Redis unavailable');
    }
    return { status: 'ok' };
  }
}
