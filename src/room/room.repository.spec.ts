import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { RoomRepository, ROOM_TTL_SECONDS } from './room.repository.js';
import type { RoomState } from '../game-engine/index.js';

// Integration test: requires a real Redis reachable via REDIS_URL (see docker-compose.yml).
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const repository = new RoomRepository(redis);

function baseRoomData(): Omit<RoomState, 'code' | 'createdAt'> {
  return {
    status: 'waiting',
    boardSize: 4,
    deck: [],
    flippedIndices: [],
    currentTurnPlayerId: 'p1',
    players: [
      { playerId: 'p1', nickname: 'Alice', score: 0, connected: true, sessionId: 's1' },
    ],
  };
}

describe('RoomRepository', () => {
  beforeEach(async () => {
    await redis.flushdb();
  });

  afterAll(async () => {
    redis.disconnect();
  });

  it('creates a room with a unique code and a TTL set', async () => {
    const state = await repository.create(baseRoomData());

    expect(state.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);

    const ttl = await redis.ttl(`room:${state.code}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(ROOM_TTL_SECONDS);
  });

  it('retries code generation on collision', async () => {
    const first = await repository.create(baseRoomData());
    const second = await repository.create(baseRoomData());

    expect(second.code).not.toBe(first.code);
  });

  it('round-trips state through get/save', async () => {
    const created = await repository.create(baseRoomData());

    const updated: RoomState = { ...created, status: 'playing' };
    await repository.save(updated);

    const fetched = await repository.get(created.code);
    expect(fetched).toEqual(updated);
  });

  it('returns null for a room that does not exist', async () => {
    expect(await repository.get('ZZZZZZ')).toBeNull();
  });

  it('deletes a room', async () => {
    const created = await repository.create(baseRoomData());
    await repository.delete(created.code);

    expect(await repository.get(created.code)).toBeNull();
  });

  it('expires and removes an abandoned room once its TTL elapses', async () => {
    const created = await repository.create(baseRoomData());
    // Simulate the TTL having almost lapsed instead of waiting the real 1h.
    await redis.expire(`room:${created.code}`, 1);

    await new Promise((resolve) => setTimeout(resolve, 1200));

    expect(await repository.get(created.code)).toBeNull();
  });

  it('does not refresh the TTL on a read-only get()', async () => {
    const created = await repository.create(baseRoomData());
    await redis.expire(`room:${created.code}`, 5);

    await repository.get(created.code);

    const ttl = await redis.ttl(`room:${created.code}`);
    expect(ttl).toBeLessThanOrEqual(5);
  });

  it('updateAtomic applies the update function and persists it', async () => {
    const created = await repository.create(baseRoomData());

    const result = await repository.updateAtomic(created.code, (state) => ({
      ...state,
      status: 'playing',
    }));

    expect(result.status).toBe('playing');
    expect((await repository.get(created.code))?.status).toBe('playing');
  });

  it('serializes concurrent updateAtomic calls without losing writes', async () => {
    const created = await repository.create({ ...baseRoomData(), status: 'playing' });

    await Promise.all(
      Array.from({ length: 5 }, () =>
        repository.updateAtomic(created.code, (state) => ({
          ...state,
          players: state.players.map((p) =>
            p.playerId === 'p1' ? { ...p, score: p.score + 1 } : p,
          ),
        })),
      ),
    );

    const final = await repository.get(created.code);
    expect(final?.players.find((p) => p.playerId === 'p1')?.score).toBe(5);
  });
});
