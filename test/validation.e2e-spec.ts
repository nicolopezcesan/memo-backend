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

describe('Negative paths (e2e)', () => {
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

  it('rejects room:start with fewer than 2 players', async () => {
    const host = newClient();
    await waitForConnect(host);
    await emitWithAck<RoomCreateAck>(host, 'room:create', { nickname: 'Alice', boardSize: 4 });

    const ack = await emitWithAck<SimpleAck>(host, 'room:start', {});
    expect(ack).toMatchObject({ ok: false, code: 'NOT_ENOUGH_PLAYERS' });
  });

  it('rejects card:flip before the game has started', async () => {
    const host = newClient();
    await waitForConnect(host);
    await emitWithAck<RoomCreateAck>(host, 'room:create', { nickname: 'Alice', boardSize: 4 });

    const ack = await emitWithAck<SimpleAck>(host, 'card:flip', { cardIndex: 0 });
    expect(ack).toMatchObject({ ok: false, code: 'GAME_NOT_STARTED' });
  });

  it('rejects room:start/card:flip from a connection with no active room', async () => {
    const client = newClient();
    await waitForConnect(client);

    const startAck = await emitWithAck<SimpleAck>(client, 'room:start', {});
    expect(startAck).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });

    const flipAck = await emitWithAck<SimpleAck>(client, 'card:flip', { cardIndex: 0 });
    expect(flipAck).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
  });

  it('rejects a flip out of turn', async () => {
    const host = newClient();
    await waitForConnect(host);
    const createAck = await emitWithAck<RoomCreateAck>(host, 'room:create', {
      nickname: 'Alice',
      boardSize: 4,
    });

    const guest = newClient();
    await waitForConnect(guest);
    await emitWithAck<RoomJoinAck>(guest, 'room:join', {
      roomCode: createAck.roomCode,
      nickname: 'Bob',
    });

    await emitWithAck<SimpleAck>(host, 'room:start', {});

    // It's the host's turn first.
    const ack = await emitWithAck<SimpleAck>(guest, 'card:flip', { cardIndex: 0 });
    expect(ack).toMatchObject({ ok: false, code: 'INVALID_TURN' });
  });

  it('rejects an out-of-range card index and flipping the same index twice', async () => {
    const host = newClient();
    await waitForConnect(host);
    const createAck = await emitWithAck<RoomCreateAck>(host, 'room:create', {
      nickname: 'Alice',
      boardSize: 4,
    });

    const guest = newClient();
    await waitForConnect(guest);
    await emitWithAck<RoomJoinAck>(guest, 'room:join', {
      roomCode: createAck.roomCode,
      nickname: 'Bob',
    });

    await emitWithAck<SimpleAck>(host, 'room:start', {});

    const outOfRange = await emitWithAck<SimpleAck>(host, 'card:flip', { cardIndex: 99 });
    expect(outOfRange).toMatchObject({ ok: false, code: 'INVALID_CARD' });

    await emitWithAck<SimpleAck>(host, 'card:flip', { cardIndex: 0 });
    const sameIndexAgain = await emitWithAck<SimpleAck>(host, 'card:flip', { cardIndex: 0 });
    expect(sameIndexAgain).toMatchObject({ ok: false, code: 'INVALID_CARD' });
  });

  it('rejects flipping a card that is already matched', async () => {
    const host = newClient();
    await waitForConnect(host);
    const createAck = await emitWithAck<RoomCreateAck>(host, 'room:create', {
      nickname: 'Alice',
      boardSize: 4,
    });
    const roomCode = createAck.roomCode!;

    const guest = newClient();
    await waitForConnect(guest);
    await emitWithAck<RoomJoinAck>(guest, 'room:join', { roomCode, nickname: 'Bob' });

    await emitWithAck<SimpleAck>(host, 'room:start', {});

    const room = await roomRepository.get(roomCode);
    const deck = room!.deck;
    const [indexA, indexB] = [0, 1, 2, 3].filter((i) => deck[i].symbol === deck[0].symbol);

    await emitWithAck<SimpleAck>(host, 'card:flip', { cardIndex: indexA });
    await emitWithAck<SimpleAck>(host, 'card:flip', { cardIndex: indexB }); // matches, host keeps the turn

    const ack = await emitWithAck<SimpleAck>(host, 'card:flip', { cardIndex: indexA });
    expect(ack).toMatchObject({ ok: false, code: 'INVALID_CARD' });
  });
});
