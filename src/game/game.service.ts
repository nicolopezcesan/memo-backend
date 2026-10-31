import { Injectable } from '@nestjs/common';
import {
  applyFlip,
  computeTurnResult,
  computeWinner,
  createBoard,
  isGameOver,
  type RoomState,
} from '../game-engine/index.js';
import { RoomRepository } from '../room/room.repository.js';
import {
  GameAlreadyStartedError,
  GameNotStartedError,
  NotEnoughPlayersError,
  NotHostError,
} from './game.errors.js';

export interface FlipCardResult {
  state: RoomState;
  /** Only set once the 2nd card of the turn was flipped and compared. */
  matched?: boolean;
  /** The 2 indices that were just compared, set together with `matched`. */
  comparedIndices?: [number, number];
  gameEnded: boolean;
  winnerId?: string | null;
}

@Injectable()
export class GameService {
  constructor(private readonly rooms: RoomRepository) {}

  async startGame(roomCode: string, requesterId: string): Promise<RoomState> {
    return this.rooms.updateAtomic(roomCode, (room) => {
      if (room.status !== 'waiting') {
        throw new GameAlreadyStartedError(room.code);
      }
      if (room.players[0]?.playerId !== requesterId) {
        throw new NotHostError(requesterId);
      }
      if (room.players.length < 2 || room.players.some((p) => !p.connected)) {
        throw new NotEnoughPlayersError(room.code);
      }

      return {
        ...room,
        status: 'playing',
        deck: createBoard(room.boardSize),
        flippedIndices: [],
        currentTurnPlayerId: room.players[0].playerId,
      };
    });
  }

  async flipCard(
    roomCode: string,
    playerId: string,
    cardIndex: number,
  ): Promise<FlipCardResult> {
    let matched: boolean | undefined;
    let comparedIndices: [number, number] | undefined;
    let gameEnded = false;
    let winnerId: string | null | undefined;

    const state = await this.rooms.updateAtomic(roomCode, (room) => {
      if (room.status !== 'playing') {
        throw new GameNotStartedError(room.code);
      }

      let next = applyFlip(room, playerId, cardIndex);

      if (next.flippedIndices.length === 2) {
        comparedIndices = [next.flippedIndices[0], next.flippedIndices[1]];
        const turnResult = computeTurnResult(next);
        next = turnResult.state;
        matched = turnResult.matched;

        if (isGameOver(next)) {
          gameEnded = true;
          winnerId = computeWinner(next.players);
          next = { ...next, status: 'finished' };
        }
      }

      return next;
    });

    return { state, matched, comparedIndices, gameEnded, winnerId };
  }
}
