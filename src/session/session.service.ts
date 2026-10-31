import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import type { SessionPayload } from './session.types.js';

// 30min, refreshed on every successful verify (reconnection). The JWT itself
// carries no `exp`: this Redis TTL is the only source of truth for vigency,
// see ADR 0002 for why a JWT with a fixed exp doesn't work for this.
export const SESSION_TTL_SECONDS = 30 * 60;

export interface IssuedSession {
  sessionToken: string;
  sessionId: string;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly jwtService: JwtService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private key(sessionId: string): string {
    return `session:${sessionId}`;
  }

  async issue(roomCode: string, playerId: string): Promise<IssuedSession> {
    const sessionId = randomUUID();
    const payload: SessionPayload = { sessionId, roomCode, playerId };

    const sessionToken = await this.jwtService.signAsync(payload);
    await this.redis.set(this.key(sessionId), roomCode, 'EX', SESSION_TTL_SECONDS);

    return { sessionToken, sessionId };
  }

  /**
   * Returns the session payload if the token is well-formed AND the
   * session:{id} key is still alive in Redis, refreshing its TTL. Returns
   * null for any other case (corrupt/invalid token, expired session) -
   * the caller (gateway) maps that to SESSION_INVALID.
   */
  async verify(sessionToken: string): Promise<SessionPayload | null> {
    let payload: SessionPayload;
    try {
      payload = await this.jwtService.verifyAsync<SessionPayload>(sessionToken);
    } catch {
      return null;
    }

    const storedRoomCode = await this.redis.get(this.key(payload.sessionId));
    if (storedRoomCode !== payload.roomCode) {
      return null;
    }

    await this.redis.expire(this.key(payload.sessionId), SESSION_TTL_SECONDS);
    return payload;
  }
}
