import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { io, type Socket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { AppModule } from '../src/app.module.js';
import { RedisIoAdapter } from '../src/redis/redis-io.adapter.js';

interface RoomCreateAck {
  ok: boolean;
  roomCode?: string;
  sessionToken?: string;
  playerId?: string;
  code?: string;
  message?: string;
}

interface RoomJoinAck {
  ok: boolean;
  sessionToken?: string;
  playerId?: string;
  state?: { players: unknown[] };
  code?: string;
  message?: string;
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

describe('GameGateway (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  const clients: Socket[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
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

  it('creates a room and allows a second client to join it', async () => {
    const clientA = newClient();
    await waitForConnect(clientA);

    const createAck = await emitWithAck<RoomCreateAck>(clientA, 'room:create', {
      nickname: 'Alice',
      boardSize: 4,
    });
    expect(createAck.ok).toBe(true);
    expect(createAck.roomCode).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);

    const clientB = newClient();
    await waitForConnect(clientB);

    const playerJoined = new Promise<{ nickname: string; players: unknown[] }>((resolve) =>
      clientA.once('room:playerJoined', resolve),
    );

    const joinAck = await emitWithAck<RoomJoinAck>(clientB, 'room:join', {
      roomCode: createAck.roomCode,
      nickname: 'Bob',
    });
    expect(joinAck.ok).toBe(true);
    expect(joinAck.state?.players).toHaveLength(2);

    const event = await playerJoined;
    expect(event.nickname).toBe('Bob');
    expect(event.players).toHaveLength(2);
  });

  it('rejects room:join for a room code that does not exist', async () => {
    const client = newClient();
    await waitForConnect(client);

    const ack = await emitWithAck<RoomJoinAck>(client, 'room:join', {
      roomCode: 'ZZZZZZ',
      nickname: 'Eve',
    });
    expect(ack).toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
  });

  it('rejects room:join once the room already has 2 players', async () => {
    const clientA = newClient();
    await waitForConnect(clientA);
    const createAck = await emitWithAck<RoomCreateAck>(clientA, 'room:create', {
      nickname: 'Alice',
      boardSize: 4,
    });

    const clientB = newClient();
    await waitForConnect(clientB);
    await emitWithAck(clientB, 'room:join', {
      roomCode: createAck.roomCode,
      nickname: 'Bob',
    });

    const clientC = newClient();
    await waitForConnect(clientC);
    const ack = await emitWithAck<RoomJoinAck>(clientC, 'room:join', {
      roomCode: createAck.roomCode,
      nickname: 'Carol',
    });
    expect(ack).toMatchObject({ ok: false, code: 'ROOM_FULL' });
  });

  it('rejects room:create with an invalid payload', async () => {
    const client = newClient();
    await waitForConnect(client);

    const ack = await emitWithAck<RoomCreateAck>(client, 'room:create', {
      nickname: '',
      boardSize: 5,
    });
    expect(ack).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
  });
});
