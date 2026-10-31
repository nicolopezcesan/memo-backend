import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { io, type Socket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { AppModule } from '../src/app.module.js';
import { RedisIoAdapter } from '../src/redis/redis-io.adapter.js';
import { RoomRepository } from '../src/room/room.repository.js';

interface RoomCreateAck {
  ok: boolean;
  roomCode?: string;
  playerId?: string;
}

interface RoomJoinAck {
  ok: boolean;
  playerId?: string;
}

interface SimpleAck {
  ok: boolean;
  code?: string;
  message?: string;
}

interface PublicCard {
  symbol: string | null;
  matched: boolean;
}

interface GameStartedEvent {
  state: { deck: PublicCard[]; currentTurnPlayerId: string };
}

interface TurnResultEvent {
  matched: boolean;
  cardIndices: [number, number];
  scores: Record<string, number>;
}

interface TurnChangedEvent {
  currentTurnPlayerId: string;
}

interface GameEndedEvent {
  scores: Record<string, number>;
  winnerId: string | null;
}

function connectClient(baseUrl: string): Socket {
  return io(baseUrl, { transports: ['websocket'], forceNew: true });
}

function waitForConnect(socket: Socket): Promise<void> {
  return new Promise((resolve) => socket.once('connect', () => resolve()));
}

function emitWithAck<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => socket.emit(event, payload, resolve as (value: T) => void));
}

function waitForEvent<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve as (value: T) => void));
}

/** Groups the 4 deck indices into [firstPair, secondPair] by symbol. */
function pairUpIndices(deck: { symbol: string }[]): [[number, number], [number, number]] {
  const bySymbol = new Map<string, number[]>();
  deck.forEach((card, index) => {
    bySymbol.set(card.symbol, [...(bySymbol.get(card.symbol) ?? []), index]);
  });
  const pairs = [...bySymbol.values()] as [number, number][];
  return [pairs[0], pairs[1]];
}

describe('Full game (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let roomRepository: RoomRepository;
  const clients: Socket[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    roomRepository = app.get(RoomRepository);
    const config = app.get(ConfigService);

    const redisIoAdapter = new RedisIoAdapter(app);
    await redisIoAdapter.connectToRedis(config.getOrThrow<string>('REDIS_URL'));
    app.useWebSocketAdapter(redisIoAdapter);

    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://localhost:${address.port}`;
  });

  afterEach(() => {
    for (const client of clients.splice(0)) {
      client.disconnect();
    }
  });

  afterAll(async () => {
    await app.close();
  });

  function newClient(): Socket {
    const client = connectClient(baseUrl);
    clients.push(client);
    return client;
  }

  async function createAndJoinRoom(): Promise<{
    host: Socket;
    guest: Socket;
    roomCode: string;
    hostId: string;
    guestId: string;
  }> {
    const host = newClient();
    await waitForConnect(host);
    const createAck = await emitWithAck<RoomCreateAck>(host, 'room:create', {
      nickname: 'Alice',
      boardSize: 4,
    });
    const roomCode = createAck.roomCode!;
    const hostId = createAck.playerId!;

    const guest = newClient();
    await waitForConnect(guest);
    const joinAck = await emitWithAck<RoomJoinAck>(guest, 'room:join', {
      roomCode,
      nickname: 'Bob',
    });
    const guestId = joinAck.playerId!;

    return { host, guest, roomCode, hostId, guestId };
  }

  it('plays a full 2x2 game end to end and reports the winner', async () => {
    const { host, guest, roomCode, hostId, guestId } = await createAndJoinRoom();

    const nonHostStart = await emitWithAck<SimpleAck>(guest, 'room:start', {});
    expect(nonHostStart).toMatchObject({ ok: false, code: 'NOT_HOST' });

    const gameStarted = waitForEvent<GameStartedEvent>(guest, 'game:started');
    const startAck = await emitWithAck<SimpleAck>(host, 'room:start', {});
    expect(startAck.ok).toBe(true);

    const started = await gameStarted;
    expect(started.state.deck).toHaveLength(4);
    expect(started.state.deck.every((card) => card.symbol === null)).toBe(true);
    expect(started.state.currentTurnPlayerId).toBe(hostId);

    // The server knows the real deck even though clients only see hidden
    // symbols; use it to script a deterministic winning sequence.
    const room = await roomRepository.get(roomCode);
    const [firstPair, secondPair] = pairUpIndices(room!.deck);

    const turnResult1 = waitForEvent<TurnResultEvent>(guest, 'turn:result');
    await emitWithAck<SimpleAck>(host, 'card:flip', { cardIndex: firstPair[0] });
    await emitWithAck<SimpleAck>(host, 'card:flip', { cardIndex: firstPair[1] });
    const result1 = await turnResult1;
    expect(result1.matched).toBe(true);
    expect(result1.scores[hostId]).toBe(1);

    // A match keeps the turn, so the host flips the remaining pair too.
    const turnResult2 = waitForEvent<TurnResultEvent>(guest, 'turn:result');
    const gameEnded = waitForEvent<GameEndedEvent>(guest, 'game:ended');
    await emitWithAck<SimpleAck>(host, 'card:flip', { cardIndex: secondPair[0] });
    await emitWithAck<SimpleAck>(host, 'card:flip', { cardIndex: secondPair[1] });

    const result2 = await turnResult2;
    expect(result2.matched).toBe(true);
    expect(result2.scores[hostId]).toBe(2);

    const ended = await gameEnded;
    expect(ended.winnerId).toBe(hostId);
    expect(ended.scores[hostId]).toBe(2);
    expect(ended.scores[guestId]).toBe(0);
  });

  it('passes the turn to the other player after a non-matching flip', async () => {
    const { host, guest, roomCode, guestId } = await createAndJoinRoom();

    const gameStarted = waitForEvent<GameStartedEvent>(guest, 'game:started');
    await emitWithAck<SimpleAck>(host, 'room:start', {});
    await gameStarted;

    const room = await roomRepository.get(roomCode);
    const [firstPair] = pairUpIndices(room!.deck);
    // Flip one card of the first pair, then a card that is NOT its match.
    const mismatchedIndex = [0, 1, 2, 3].find(
      (i) => i !== firstPair[0] && i !== firstPair[1],
    )!;

    const turnChanged = waitForEvent<TurnChangedEvent>(guest, 'turn:changed');
    await emitWithAck<SimpleAck>(host, 'card:flip', { cardIndex: firstPair[0] });
    await emitWithAck<SimpleAck>(host, 'card:flip', { cardIndex: mismatchedIndex });

    const event = await turnChanged;
    expect(event.currentTurnPlayerId).toBe(guestId);
  });

  it('rejects room:start from a non-host player', async () => {
    const { guest } = await createAndJoinRoom();

    const ack = await emitWithAck<SimpleAck>(guest, 'room:start', {});
    expect(ack).toMatchObject({ ok: false, code: 'NOT_HOST' });
  });
});
