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
}

interface RoomJoinAck {
  ok: boolean;
  sessionToken?: string;
  playerId?: string;
}

interface SimpleAck {
  ok: boolean;
  code?: string;
}

interface PlayerDisconnectedEvent {
  playerId: string;
}

interface PlayerReconnectedEvent {
  playerId: string;
}

interface SessionResumedEvent {
  playerId: string;
  state: { players: { playerId: string; connected: boolean }[] };
}

interface ErrorEvent {
  code: string;
  message: string;
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

describe('Reconnection (e2e)', () => {
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

  function newClient(auth?: Record<string, unknown>): Socket {
    const client = io(baseUrl, { transports: ['websocket'], forceNew: true, auth });
    clients.push(client);
    return client;
  }

  it('notifies the other player on disconnect and restores state on reconnect', async () => {
    const host = newClient();
    await waitForConnect(host);
    const createAck = await emitWithAck<RoomCreateAck>(host, 'room:create', {
      nickname: 'Alice',
      boardSize: 4,
    });
    const roomCode = createAck.roomCode!;

    const guest = newClient();
    await waitForConnect(guest);
    const joinAck = await emitWithAck<RoomJoinAck>(guest, 'room:join', {
      roomCode,
      nickname: 'Bob',
    });
    const guestSessionToken = joinAck.sessionToken!;
    const guestId = joinAck.playerId!;

    const disconnected = waitForEvent<PlayerDisconnectedEvent>(host, 'player:disconnected');
    guest.disconnect();
    const disconnectedEvent = await disconnected;
    expect(disconnectedEvent.playerId).toBe(guestId);

    const reconnected = waitForEvent<PlayerReconnectedEvent>(host, 'player:reconnected');
    const reconnectingGuest = newClient({ sessionToken: guestSessionToken });
    const sessionResumed = waitForEvent<SessionResumedEvent>(reconnectingGuest, 'session:resumed');
    await waitForConnect(reconnectingGuest);

    const resumed = await sessionResumed;
    expect(resumed.playerId).toBe(guestId);
    expect(resumed.state.players.find((p) => p.playerId === guestId)?.connected).toBe(true);

    const reconnectedEvent = await reconnected;
    expect(reconnectedEvent.playerId).toBe(guestId);

    // The reconnected socket must be usable for subsequent game actions
    // without resending roomCode/playerId - identity is rebound on connect.
    const startAck = await emitWithAck<SimpleAck>(host, 'room:start', {});
    expect(startAck.ok).toBe(true);
  });

  it('emits SESSION_INVALID for a bogus session token', async () => {
    const client = newClient({ sessionToken: 'not-a-real-token' });
    const errorEvent = waitForEvent<ErrorEvent>(client, 'error');
    await waitForConnect(client);

    const event = await errorEvent;
    expect(event.code).toBe('SESSION_INVALID');
  });
});
