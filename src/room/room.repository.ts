import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import type { RoomState } from '../game-engine/index.js';
import { generateRoomCode } from './room-code.js';

export const ROOM_TTL_SECONDS = 60 * 60; // 1h, refreshed on every write
const MAX_CODE_GENERATION_ATTEMPTS = 10;
const MAX_ATOMIC_UPDATE_RETRIES = 5;

@Injectable()
export class RoomRepository {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private key(code: string): string {
    return `room:${code}`;
  }

  async generateUniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt++) {
      const code = generateRoomCode();
      const exists = await this.redis.exists(this.key(code));
      if (!exists) return code;
    }
    throw new Error(
      `Could not generate a unique room code after ${MAX_CODE_GENERATION_ATTEMPTS} attempts`,
    );
  }

  async create(data: Omit<RoomState, 'code' | 'createdAt'>): Promise<RoomState> {
    const code = await this.generateUniqueCode();
    const state: RoomState = { ...data, code, createdAt: Date.now() };
    await this.save(state);
    return state;
  }

  async get(code: string): Promise<RoomState | null> {
    const raw = await this.redis.get(this.key(code));
    return raw ? (JSON.parse(raw) as RoomState) : null;
  }

  async save(state: RoomState): Promise<void> {
    await this.redis.set(
      this.key(state.code),
      JSON.stringify(state),
      'EX',
      ROOM_TTL_SECONDS,
    );
  }

  async delete(code: string): Promise<void> {
    await this.redis.del(this.key(code));
  }

  /**
   * Optimistic concurrency update: reads the current state, applies `updateFn`
   * (a pure function, e.g. from game-engine), and writes it back only if no
   * other write happened in between. Retries on conflict instead of using a
   * Lua script, so the game rules stay only in game-engine (see ADR 0001/0003).
   */
  async updateAtomic(
    code: string,
    updateFn: (state: RoomState) => RoomState,
  ): Promise<RoomState> {
    const key = this.key(code);
    // WATCH is connection-scoped: a dedicated connection avoids one concurrent
    // flip's WATCH/EXEC interfering with another's on the shared client.
    const connection = this.redis.duplicate();

    try {
      for (let attempt = 0; attempt < MAX_ATOMIC_UPDATE_RETRIES; attempt++) {
        await connection.watch(key);

        const raw = await connection.get(key);
        if (!raw) {
          await connection.unwatch();
          throw new Error(`Room ${code} not found`);
        }

        const nextState = updateFn(JSON.parse(raw) as RoomState);

        const result = await connection
          .multi()
          .set(key, JSON.stringify(nextState), 'EX', ROOM_TTL_SECONDS)
          .exec();

        // ioredis returns null from exec() when the transaction was aborted
        // because a watched key changed in between (optimistic lock conflict).
        if (result !== null) {
          return nextState;
        }
      }

      throw new Error(
        `Could not update room ${code} atomically after ${MAX_ATOMIC_UPDATE_RETRIES} attempts`,
      );
    } finally {
      connection.disconnect();
    }
  }
}
