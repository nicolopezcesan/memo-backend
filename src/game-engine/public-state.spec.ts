import { describe, expect, it } from 'vitest';
import { toPublicRoomState } from './public-state.js';
import type { RoomState } from './types.js';

function makeState(overrides: Partial<RoomState> = {}): RoomState {
  return {
    code: 'ABC123',
    status: 'playing',
    boardSize: 4,
    deck: [
      { symbol: 'a', matched: true },
      { symbol: 'a', matched: true },
      { symbol: 'b', matched: false },
      { symbol: 'b', matched: false },
    ],
    flippedIndices: [2],
    currentTurnPlayerId: 'p1',
    players: [],
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('toPublicRoomState', () => {
  it('reveals the symbol of matched cards and currently flipped cards only', () => {
    const publicState = toPublicRoomState(makeState());

    expect(publicState.deck[0]).toEqual({ symbol: 'a', matched: true });
    expect(publicState.deck[1]).toEqual({ symbol: 'a', matched: true });
    expect(publicState.deck[2]).toEqual({ symbol: 'b', matched: false });
    expect(publicState.deck[3]).toEqual({ symbol: null, matched: false });
  });
});
