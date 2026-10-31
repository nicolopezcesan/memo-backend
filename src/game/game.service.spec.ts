import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { NotPlayersTurnError } from '../game-engine/index.js';
import { RoomRepository } from '../room/room.repository.js';
import type { RoomState } from '../game-engine/index.js';
import { GameService } from './game.service.js';
import {
  GameAlreadyStartedError,
  GameNotStartedError,
  NotEnoughPlayersError,
  NotHostError,
} from './game.errors.js';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const rooms = new RoomRepository(redis);
const game = new GameService(rooms);

function basePlayers() {
  return [
    { playerId: 'host', nickname: 'Alice', score: 0, connected: true, sessionId: 's1' },
    { playerId: 'guest', nickname: 'Bob', score: 0, connected: true, sessionId: 's2' },
  ];
}

async function createRoom(overrides: Partial<RoomState> = {}): Promise<RoomState> {
  return rooms.create({
    status: 'waiting',
    boardSize: 4,
    deck: [],
    flippedIndices: [],
    currentTurnPlayerId: 'host',
    players: basePlayers(),
    ...overrides,
  });
}

describe('GameService', () => {
  beforeEach(async () => {
    await redis.flushdb();
  });

  afterAll(async () => {
    redis.disconnect();
  });

  describe('startGame', () => {
    it('starts the game when the host requests it with 2 connected players', async () => {
      const room = await createRoom();

      const state = await game.startGame(room.code, 'host');

      expect(state.status).toBe('playing');
      expect(state.deck).toHaveLength(4);
      expect(state.currentTurnPlayerId).toBe('host');
    });

    it('rejects a non-host requester', async () => {
      const room = await createRoom();
      await expect(game.startGame(room.code, 'guest')).rejects.toThrow(NotHostError);
    });

    it('rejects starting with fewer than 2 players', async () => {
      const room = await createRoom({ players: [basePlayers()[0]] });
      await expect(game.startGame(room.code, 'host')).rejects.toThrow(
        NotEnoughPlayersError,
      );
    });

    it('rejects starting if a player is disconnected', async () => {
      const players = basePlayers();
      players[1].connected = false;
      const room = await createRoom({ players });
      await expect(game.startGame(room.code, 'host')).rejects.toThrow(
        NotEnoughPlayersError,
      );
    });

    it('rejects starting a room that is not waiting', async () => {
      const room = await createRoom({ status: 'playing' });
      await expect(game.startGame(room.code, 'host')).rejects.toThrow(
        GameAlreadyStartedError,
      );
    });
  });

  describe('flipCard', () => {
    async function createPlayingRoom(): Promise<RoomState> {
      const room = await createRoom();
      return game.startGame(room.code, 'host');
    }

    it('rejects flipping before the game has started', async () => {
      const room = await createRoom();
      await expect(game.flipCard(room.code, 'host', 0)).rejects.toThrow(
        GameNotStartedError,
      );
    });

    it('rejects a flip out of turn', async () => {
      const room = await createPlayingRoom();
      await expect(game.flipCard(room.code, 'guest', 0)).rejects.toThrow(
        NotPlayersTurnError,
      );
    });

    it('returns matched=undefined after the first flip of a turn', async () => {
      const room = await createPlayingRoom();
      const result = await game.flipCard(room.code, 'host', 0);

      expect(result.matched).toBeUndefined();
      expect(result.gameEnded).toBe(false);
      expect(result.state.flippedIndices).toEqual([0]);
    });

    it('resolves the turn and ends the game once all pairs are found', async () => {
      const room = await createPlayingRoom();
      const deck = room.deck;
      const [indexA, indexB] = [0, 1, 2, 3].filter(
        (i) => deck[i].symbol === deck[0].symbol,
      );
      const [otherA, otherB] = [0, 1, 2, 3].filter((i) => i !== indexA && i !== indexB);

      await game.flipCard(room.code, 'host', indexA);
      const firstPair = await game.flipCard(room.code, 'host', indexB);
      expect(firstPair.matched).toBe(true);
      expect(firstPair.comparedIndices).toEqual([indexA, indexB]);
      expect(firstPair.gameEnded).toBe(false);

      await game.flipCard(room.code, 'host', otherA);
      const secondPair = await game.flipCard(room.code, 'host', otherB);
      expect(secondPair.matched).toBe(true);
      expect(secondPair.gameEnded).toBe(true);
      expect(secondPair.winnerId).toBe('host');
      expect(secondPair.state.status).toBe('finished');
    });
  });
});
