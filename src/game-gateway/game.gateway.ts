import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { PublicRoomState, RoomState } from '../game-engine/index.js';
import {
  CardAlreadyMatchedError,
  InvalidCardIndexError,
  NotPlayersTurnError,
  toPublicPlayer,
  toPublicRoomState,
} from '../game-engine/index.js';
import {
  GameAlreadyStartedError,
  GameNotStartedError,
  NotEnoughPlayersError,
  NotHostError,
} from '../game/game.errors.js';
import { GameService } from '../game/game.service.js';
import { RoomFullError, RoomNotFoundError } from '../room/room.errors.js';
import { RoomRepository } from '../room/room.repository.js';
import { SessionService } from '../session/session.service.js';
import { errAck, type Ack } from './ack.js';
import { CardFlipDto } from './dto/card-flip.dto.js';
import { RoomCreateDto } from './dto/room-create.dto.js';
import { RoomJoinDto } from './dto/room-join.dto.js';
import { bindSocketIdentity, getSocketIdentity } from './socket-identity.js';
import { validateDto } from './validate-dto.js';
import { withAckErrorHandling } from './with-ack-error-handling.js';

type RoomCreateAck = Ack<{
  roomCode: string;
  sessionToken: string;
  playerId: string;
  state: PublicRoomState;
}>;
type RoomJoinAck = Ack<{
  sessionToken: string;
  playerId: string;
  state: PublicRoomState;
}>;
type RoomStartAck = Ack<object>;
type CardFlipAck = Ack<object>;
type RoomLeaveAck = Ack<object>;

const NOT_IN_ROOM = errAck('VALIDATION_ERROR', 'This connection has not created or joined a room yet');

@WebSocketGateway({ cors: { origin: process.env.CORS_ORIGIN } })
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private readonly server!: Server;

  private readonly logger = new Logger(GameGateway.name);

  constructor(
    private readonly rooms: RoomRepository,
    private readonly sessions: SessionService,
    private readonly game: GameService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const sessionToken = client.handshake.auth.sessionToken as string | undefined;
    if (!sessionToken) return; // Brand new connection; will room:create/room:join.

    const payload = await this.sessions.verify(sessionToken);
    const room = payload ? await this.rooms.get(payload.roomCode) : null;
    if (!payload || !room) {
      this.logger.warn(`session:invalid sessionToken=${sessionToken.slice(0, 8)}…`);
      client.emit('error', {
        code: 'SESSION_INVALID',
        message: 'Session token is invalid or expired',
      });
      return;
    }

    const state = await this.rooms.updateAtomic(payload.roomCode, (current) => ({
      ...current,
      players: current.players.map((p) =>
        p.playerId === payload.playerId ? { ...p, connected: true } : p,
      ),
    }));

    await client.join(payload.roomCode);
    bindSocketIdentity(client, { playerId: payload.playerId, roomCode: payload.roomCode });

    this.logger.log(
      `session:resumed roomCode=${payload.roomCode} playerId=${payload.playerId} sessionId=${payload.sessionId}`,
    );
    client.emit('session:resumed', { state: toPublicRoomState(state), playerId: payload.playerId });
    client.to(payload.roomCode).emit('player:reconnected', { playerId: payload.playerId });
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const identity = getSocketIdentity(client);
    if (!identity) return;

    try {
      await this.rooms.updateAtomic(identity.roomCode, (room) => ({
        ...room,
        players: room.players.map((p) =>
          p.playerId === identity.playerId ? { ...p, connected: false } : p,
        ),
      }));
    } catch (error) {
      if (!(error instanceof RoomNotFoundError)) throw error;
      return; // Room already expired/cleaned up; nothing to mark.
    }

    this.logger.log(
      `player:disconnected roomCode=${identity.roomCode} playerId=${identity.playerId}`,
    );
    client.to(identity.roomCode).emit('player:disconnected', { playerId: identity.playerId });
  }

  @SubscribeMessage('room:create')
  async handleRoomCreate(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: Socket,
  ): Promise<RoomCreateAck> {
    return withAckErrorHandling('room:create', async () => {
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
      bindSocketIdentity(client, { playerId, roomCode });

      this.logger.log(
        `room:create roomCode=${roomCode} playerId=${playerId} sessionId=${session.sessionId}`,
      );
      return {
        ok: true,
        roomCode,
        sessionToken: session.sessionToken,
        playerId,
        state: toPublicRoomState(room),
      };
    });
  }

  @SubscribeMessage('room:join')
  async handleRoomJoin(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: Socket,
  ): Promise<RoomJoinAck> {
    return withAckErrorHandling('room:join', async () => {
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
      bindSocketIdentity(client, { playerId, roomCode: dto.roomCode });
      this.logger.log(
        `room:join roomCode=${dto.roomCode} playerId=${playerId} sessionId=${session.sessionId}`,
      );
      client.to(dto.roomCode).emit('room:playerJoined', {
        playerId,
        nickname: dto.nickname,
        players: state.players.map(toPublicPlayer),
      });

      return {
        ok: true,
        sessionToken: session.sessionToken,
        playerId,
        state: toPublicRoomState(state),
      };
    });
  }

  @SubscribeMessage('room:start')
  async handleRoomStart(@ConnectedSocket() client: Socket): Promise<RoomStartAck> {
    return withAckErrorHandling('room:start', async () => {
      const identity = getSocketIdentity(client);
      if (!identity) return NOT_IN_ROOM;

      try {
        const state = await this.game.startGame(identity.roomCode, identity.playerId);
        this.logger.log(
          `game:started roomCode=${identity.roomCode} playerId=${identity.playerId} boardSize=${state.boardSize}`,
        );
        this.server
          .to(identity.roomCode)
          .emit('game:started', { state: toPublicRoomState(state) });
        return { ok: true };
      } catch (error) {
        if (error instanceof NotHostError) {
          return errAck('NOT_HOST', error.message);
        }
        if (error instanceof GameAlreadyStartedError) {
          return errAck('GAME_ALREADY_STARTED', error.message);
        }
        if (error instanceof NotEnoughPlayersError) {
          return errAck('NOT_ENOUGH_PLAYERS', error.message);
        }
        throw error;
      }
    });
  }

  @SubscribeMessage('card:flip')
  async handleCardFlip(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: Socket,
  ): Promise<CardFlipAck> {
    return withAckErrorHandling('card:flip', async () => {
      const identity = getSocketIdentity(client);
      if (!identity) return NOT_IN_ROOM;

      const validation = await validateDto(CardFlipDto, body);
      if (!validation.ok) {
        return errAck('VALIDATION_ERROR', validation.message);
      }
      const { dto } = validation;

      try {
        const result = await this.game.flipCard(
          identity.roomCode,
          identity.playerId,
          dto.cardIndex,
        );

        this.server.to(identity.roomCode).emit('card:flipped', {
          cardIndex: dto.cardIndex,
          symbol: result.state.deck[dto.cardIndex].symbol,
          byPlayerId: identity.playerId,
        });

        if (result.matched !== undefined && result.comparedIndices) {
          const scores = Object.fromEntries(
            result.state.players.map((p) => [p.playerId, p.score]),
          );
          this.server.to(identity.roomCode).emit('turn:result', {
            matched: result.matched,
            cardIndices: result.comparedIndices,
            scores,
          });

          if (!result.matched) {
            this.server.to(identity.roomCode).emit('turn:changed', {
              currentTurnPlayerId: result.state.currentTurnPlayerId,
            });
          }

          if (result.gameEnded) {
            const finalScores = Object.fromEntries(
              result.state.players.map((p) => [p.playerId, p.score]),
            );
            this.logger.log(
              `game:ended roomCode=${identity.roomCode} winnerId=${result.winnerId ?? 'draw'}`,
            );
            this.server.to(identity.roomCode).emit('game:ended', {
              scores: finalScores,
              winnerId: result.winnerId ?? null,
            });
          }
        }

        return { ok: true };
      } catch (error) {
        if (error instanceof GameNotStartedError) {
          return errAck('GAME_NOT_STARTED', error.message);
        }
        if (error instanceof NotPlayersTurnError) {
          return errAck('INVALID_TURN', error.message);
        }
        if (
          error instanceof InvalidCardIndexError ||
          error instanceof CardAlreadyMatchedError
        ) {
          return errAck('INVALID_CARD', error.message);
        }
        throw error;
      }
    });
  }

  @SubscribeMessage('room:leave')
  async handleRoomLeave(@ConnectedSocket() client: Socket): Promise<RoomLeaveAck> {
    return withAckErrorHandling('room:leave', async () => {
      const identity = getSocketIdentity(client);
      if (!identity) return NOT_IN_ROOM;

      // A deliberate leave ends the game for both players, unlike a mere
      // disconnect (which keeps the room alive for a reconnect). Deleting
      // it also makes the remaining player's eventual reconnect attempt
      // get SESSION_INVALID for free, via the existing !room check in
      // handleConnection.
      await this.rooms.delete(identity.roomCode);
      this.logger.log(
        `room:leave roomCode=${identity.roomCode} playerId=${identity.playerId}`,
      );
      client.to(identity.roomCode).emit('player:left', { playerId: identity.playerId });
      await client.leave(identity.roomCode);

      return { ok: true };
    });
  }
}
