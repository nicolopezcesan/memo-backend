import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { RedisIoAdapter } from './redis/redis-io.adapter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.enableCors({ origin: config.getOrThrow<string>('CORS_ORIGIN') });

  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis(config.getOrThrow<string>('REDIS_URL'));
  app.useWebSocketAdapter(redisIoAdapter);

  await app.listen(config.getOrThrow<number>('PORT'));
}
await bootstrap();
