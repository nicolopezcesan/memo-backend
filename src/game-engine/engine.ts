import type { PlayerState, RoomState } from './types.js';
import {
  CardAlreadyMatchedError,
  GameEngineError,
  InvalidCardIndexError,
  NotPlayersTurnError,
} from './errors.js';

export function applyFlip(
  state: RoomState,
  playerId: string,
  cardIndex: number,
): RoomState {
  if (state.currentTurnPlayerId !== playerId) {
    throw new NotPlayersTurnError(playerId);
  }
  if (cardIndex < 0 || cardIndex >= state.deck.length) {
    throw new InvalidCardIndexError(cardIndex);
  }
  if (state.deck[cardIndex].matched) {
    throw new CardAlreadyMatchedError(cardIndex);
  }
  if (state.flippedIndices.includes(cardIndex)) {
    throw new InvalidCardIndexError(cardIndex);
  }

  return {
    ...state,
    flippedIndices: [...state.flippedIndices, cardIndex],
  };
}

export interface TurnResult {
  state: RoomState;
  matched: boolean;
}

export function computeTurnResult(state: RoomState): TurnResult {
  if (state.flippedIndices.length !== 2) {
    throw new GameEngineError(
      `computeTurnResult requires exactly 2 flipped cards, got ${state.flippedIndices.length}`,
    );
  }
  const [firstIndex, secondIndex] = state.flippedIndices;
  const matched = state.deck[firstIndex].symbol === state.deck[secondIndex].symbol;

  const deck = state.deck.map((card, index) =>
    matched && (index === firstIndex || index === secondIndex)
      ? { ...card, matched: true }
      : card,
  );

  const players = matched
    ? state.players.map((player) =>
        player.playerId === state.currentTurnPlayerId
          ? { ...player, score: player.score + 1 }
          : player,
      )
    : state.players;

  const nextTurnPlayerId = matched
    ? state.currentTurnPlayerId
    : (state.players.find((p) => p.playerId !== state.currentTurnPlayerId)
        ?.playerId ?? state.currentTurnPlayerId);

  return {
    matched,
    state: {
      ...state,
      deck,
      players,
      flippedIndices: [],
      currentTurnPlayerId: nextTurnPlayerId,
    },
  };
}

export function isGameOver(state: RoomState): boolean {
  return state.deck.every((card) => card.matched);
}

export function computeWinner(players: readonly PlayerState[]): string | null {
  const [best, second] = [...players].sort((a, b) => b.score - a.score);
  if (!best) return null;
  if (second && second.score === best.score) return null;
  return best.playerId;
}
