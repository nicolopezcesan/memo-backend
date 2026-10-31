import { describe, expect, it } from 'vitest';
import {
  applyFlip,
  computeTurnResult,
  computeWinner,
  isGameOver,
} from './engine.js';
import {
  CardAlreadyMatchedError,
  GameEngineError,
  InvalidCardIndexError,
  NotPlayersTurnError,
} from './errors.js';
import type { RoomState } from './types.js';

function makeState(overrides: Partial<RoomState> = {}): RoomState {
  return {
    code: 'ABC123',
    status: 'playing',
    boardSize: 4,
    deck: [
      { symbol: 'a', matched: false },
      { symbol: 'a', matched: false },
      { symbol: 'b', matched: false },
      { symbol: 'b', matched: false },
    ],
    flippedIndices: [],
    currentTurnPlayerId: 'p1',
    players: [
      { playerId: 'p1', nickname: 'Alice', score: 0, connected: true, sessionId: 's1' },
      { playerId: 'p2', nickname: 'Bob', score: 0, connected: true, sessionId: 's2' },
    ],
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('applyFlip', () => {
  it('adds the card index to flippedIndices', () => {
    const result = applyFlip(makeState(), 'p1', 0);
    expect(result.flippedIndices).toEqual([0]);
  });

  it('throws NotPlayersTurnError when it is not the player\'s turn', () => {
    expect(() => applyFlip(makeState(), 'p2', 0)).toThrow(NotPlayersTurnError);
  });

  it('throws InvalidCardIndexError for an out-of-range index', () => {
    expect(() => applyFlip(makeState(), 'p1', 99)).toThrow(InvalidCardIndexError);
  });

  it('throws CardAlreadyMatchedError when the card is already matched', () => {
    const state = makeState({
      deck: [
        { symbol: 'a', matched: true },
        { symbol: 'a', matched: true },
        { symbol: 'b', matched: false },
        { symbol: 'b', matched: false },
      ],
    });
    expect(() => applyFlip(state, 'p1', 0)).toThrow(CardAlreadyMatchedError);
  });

  it('throws InvalidCardIndexError when flipping the same index twice', () => {
    const state = makeState({ flippedIndices: [0] });
    expect(() => applyFlip(state, 'p1', 0)).toThrow(InvalidCardIndexError);
  });
});

describe('computeTurnResult', () => {
  it('throws if flippedIndices does not have exactly 2 entries', () => {
    expect(() => computeTurnResult(makeState({ flippedIndices: [0] }))).toThrow(
      GameEngineError,
    );
  });

  it('marks both cards matched and keeps the turn when they match', () => {
    const state = makeState({ flippedIndices: [0, 1] });
    const { matched, state: next } = computeTurnResult(state);

    expect(matched).toBe(true);
    expect(next.deck[0].matched).toBe(true);
    expect(next.deck[1].matched).toBe(true);
    expect(next.flippedIndices).toEqual([]);
    expect(next.currentTurnPlayerId).toBe('p1');
    expect(next.players.find((p) => p.playerId === 'p1')?.score).toBe(1);
  });

  it('passes the turn to the other player when the cards do not match', () => {
    const state = makeState({ flippedIndices: [0, 2] });
    const { matched, state: next } = computeTurnResult(state);

    expect(matched).toBe(false);
    expect(next.deck[0].matched).toBe(false);
    expect(next.deck[2].matched).toBe(false);
    expect(next.currentTurnPlayerId).toBe('p2');
    expect(next.players.find((p) => p.playerId === 'p1')?.score).toBe(0);
  });
});

describe('isGameOver', () => {
  it('is false while some cards remain unmatched', () => {
    expect(isGameOver(makeState())).toBe(false);
  });

  it('is true once every card is matched', () => {
    const state = makeState({
      deck: [
        { symbol: 'a', matched: true },
        { symbol: 'a', matched: true },
        { symbol: 'b', matched: true },
        { symbol: 'b', matched: true },
      ],
    });
    expect(isGameOver(state)).toBe(true);
  });
});

describe('computeWinner', () => {
  it('returns the playerId with the highest score', () => {
    const players = [
      { playerId: 'p1', nickname: 'Alice', score: 2, connected: true, sessionId: 's1' },
      { playerId: 'p2', nickname: 'Bob', score: 1, connected: true, sessionId: 's2' },
    ];
    expect(computeWinner(players)).toBe('p1');
  });

  it('returns null on a tie', () => {
    const players = [
      { playerId: 'p1', nickname: 'Alice', score: 2, connected: true, sessionId: 's1' },
      { playerId: 'p2', nickname: 'Bob', score: 2, connected: true, sessionId: 's2' },
    ];
    expect(computeWinner(players)).toBeNull();
  });
});
