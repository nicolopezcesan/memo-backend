import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { RedisModule } from '../redis/redis.module.js';
import { SessionService } from './session.service.js';

@Module({
  imports: [
    RedisModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      // No `expiresIn`: the JWT carries no exp, Redis TTL is the source of
      // vigency (ADR 0002).
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  providers: [SessionService],
  exports: [SessionService],
})
export class SessionModule {}
