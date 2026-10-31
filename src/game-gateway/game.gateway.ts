import { randomUUID } from 'node:crypto';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import type { RoomState } from '../game-engine/index.js';
import { RoomFullError } from '../room/room.errors.js';
import { RoomRepository } from '../room/room.repository.js';
import { SessionService } from '../session/session.service.js';
import { errAck, type Ack } from './ack.js';
import { RoomCreateDto } from './dto/room-create.dto.js';
import { RoomJoinDto } from './dto/room-join.dto.js';
import { validateDto } from './validate-dto.js';

type RoomCreateAck = Ack<{ roomCode: string; sessionToken: string; playerId: string }>;
type RoomJoinAck = Ack<{ sessionToken: string; playerId: string; state: RoomState }>;

@WebSocketGateway({ cors: { origin: process.env.CORS_ORIGIN } })
export class GameGateway {
  constructor(
    private readonly rooms: RoomRepository,
    private readonly sessions: SessionService,
  ) {}

  @SubscribeMessage('room:create')
  async handleRoomCreate(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: Socket,
  ): Promise<RoomCreateAck> {
    const validation = await validateDto(RoomCreateDto, body);
    if (!validation.ok) {
      return errAck('VALIDATION_ERROR', validation.message);
    }
    const { dto } = validation;

    const playerId = randomUUID();
    const roomCode = await this.rooms.generateUniqueCode();
    const session = await this.sessions.issue(roomCode, playerId);

    const room: RoomState = {
      code: roomCode,
      status: 'waiting',
      boardSize: dto.boardSize,
      deck: [],
      flippedIndices: [],
      currentTurnPlayerId: playerId,
      players: [
        {
          playerId,
          nickname: dto.nickname,
          score: 0,
          connected: true,
          sessionId: session.sessionId,
        },
      ],
      createdAt: Date.now(),
    };
    await this.rooms.save(room);

    await client.join(roomCode);

    return { ok: true, roomCode, sessionToken: session.sessionToken, playerId };
  }

  @SubscribeMessage('room:join')
  async handleRoomJoin(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: Socket,
  ): Promise<RoomJoinAck> {
    const validation = await validateDto(RoomJoinDto, body);
    if (!validation.ok) {
      return errAck('VALIDATION_ERROR', validation.message);
    }
    const { dto } = validation;

    const existing = await this.rooms.get(dto.roomCode);
    if (!existing) {
      return errAck('ROOM_NOT_FOUND', `No room found for code ${dto.roomCode}`);
    }
    if (existing.players.length >= 2) {
      return errAck('ROOM_FULL', `Room ${dto.roomCode} already has 2 players`);
    }

    const playerId = randomUUID();
    const session = await this.sessions.issue(dto.roomCode, playerId);

    let state: RoomState;
    try {
      state = await this.rooms.updateAtomic(dto.roomCode, (room) => {
        if (room.players.length >= 2) {
          // Re-checked here in case another join raced past the check above.
          throw new RoomFullError(room.code);
        }
        return {
          ...room,
          players: [
            ...room.players,
            {
              playerId,
              nickname: dto.nickname,
              score: 0,
              connected: true,
              sessionId: session.sessionId,
            },
          ],
        };
      });
    } catch (error) {
      if (error instanceof RoomFullError) {
        return errAck('ROOM_FULL', error.message);
      }
      throw error;
    }

    await client.join(dto.roomCode);
    client.to(dto.roomCode).emit('room:playerJoined', {
      playerId,
      nickname: dto.nickname,
      players: state.players,
    });

    return { ok: true, sessionToken: session.sessionToken, playerId, state };
  }
}
