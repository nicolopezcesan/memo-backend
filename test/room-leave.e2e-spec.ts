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
  sessionToken?: string;
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

interface PlayerLeftEvent {
  playerId: string;
}

interface ErrorEvent {
  code: string;
  message: string;
}

function connectClient(baseUrl: string, auth?: Record<string, unknown>): Socket {
  return io(baseUrl, { transports: ['websocket'], forceNew: true, auth });
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

describe('room:leave (e2e)', () => {
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

  function newClient(auth?: Record<string, unknown>): Socket {
    const client = connectClient(baseUrl, auth);
    clients.push(client);
    return client;
  }

  it('deletes the room and notifies the other player with player:left', async () => {
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
    await emitWithAck<RoomJoinAck>(guest, 'room:join', { roomCode, nickname: 'Bob' });

    const playerLeft = waitForEvent<PlayerLeftEvent>(guest, 'player:left');
    const leaveAck = await emitWithAck<SimpleAck>(host, 'room:leave', {});
    expect(leaveAck.ok).toBe(true);

    const event = await playerLeft;
    expect(event.playerId).toBe(hostId);

    expect(await roomRepository.get(roomCode)).toBeNull();
  });

  it('rejects room:leave from a connection with no active room', async () => {
    const client = newClient();
    await waitForConnect(client);

    const ack = await emitWithAck<SimpleAck>(client, 'room:leave', {});
    expect(ack).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
  });

  it('gives the remaining player SESSION_INVALID if they try to reconnect after the other left', async () => {
    const host = newClient();
    await waitForConnect(host);
    const createAck = await emitWithAck<RoomCreateAck>(host, 'room:create', {
      nickname: 'Alice',
      boardSize: 4,
    });
    const roomCode = createAck.roomCode!;

    const guest = newClient();
    await waitForConnect(guest);
    const joinAck = await emitWithAck<RoomJoinAck & { sessionToken?: string }>(
      guest,
      'room:join',
      { roomCode, nickname: 'Bob' },
    );

    await emitWithAck<SimpleAck>(host, 'room:leave', {});
    guest.disconnect();

    const reconnecting = newClient({ sessionToken: joinAck.sessionToken });
    const errorEvent = waitForEvent<ErrorEvent>(reconnecting, 'error');
    await waitForConnect(reconnecting);

    const event = await errorEvent;
    expect(event.code).toBe('SESSION_INVALID');
  });
});
