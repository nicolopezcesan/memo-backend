import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { JwtService } from '@nestjs/jwt';
import { SessionService, SESSION_TTL_SECONDS } from './session.service.js';

// Integration test: requires a real Redis reachable via REDIS_URL (see docker-compose.yml).
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const jwtService = new JwtService({ secret: 'test-secret-at-least-16-chars' });
const sessionService = new SessionService(jwtService, redis);

describe('SessionService', () => {
  beforeEach(async () => {
    await redis.flushdb();
  });

  afterAll(async () => {
    redis.disconnect();
  });

  it('issues a token and persists the session with a TTL', async () => {
    const { sessionToken, sessionId } = await sessionService.issue('ABC123', 'p1');

    expect(sessionToken).toBeTypeOf('string');
    const ttl = await redis.ttl(`session:${sessionId}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(SESSION_TTL_SECONDS);
  });

  it('verifies a valid token and returns its payload', async () => {
    const { sessionToken } = await sessionService.issue('ABC123', 'p1');

    const payload = await sessionService.verify(sessionToken);
    expect(payload).toMatchObject({ roomCode: 'ABC123', playerId: 'p1' });
  });

  it('refreshes the session TTL on successful verify', async () => {
    const { sessionToken, sessionId } = await sessionService.issue('ABC123', 'p1');
    await redis.expire(`session:${sessionId}`, 5);

    await sessionService.verify(sessionToken);

    const ttl = await redis.ttl(`session:${sessionId}`);
    expect(ttl).toBeGreaterThan(5);
  });

  it('returns null for a corrupt/invalid token', async () => {
    expect(await sessionService.verify('not-a-jwt')).toBeNull();
  });

  it('returns null when the session expired/was removed from Redis', async () => {
    const { sessionToken, sessionId } = await sessionService.issue('ABC123', 'p1');
    await redis.del(`session:${sessionId}`);

    expect(await sessionService.verify(sessionToken)).toBeNull();
  });

  it('returns null when the token is valid but the stored roomCode does not match', async () => {
    const { sessionToken, sessionId } = await sessionService.issue('ABC123', 'p1');
    await redis.set(`session:${sessionId}`, 'TAMPERED');

    expect(await sessionService.verify(sessionToken)).toBeNull();
  });
});
