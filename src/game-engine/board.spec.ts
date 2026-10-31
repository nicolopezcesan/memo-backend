import { describe, expect, it } from 'vitest';
import { createBoard, shuffle } from './board.js';
import { InvalidBoardSizeError } from './errors.js';

describe('shuffle', () => {
  it('returns a permutation of the same elements without mutating the input', () => {
    const input = [1, 2, 3, 4, 5];
    const result = shuffle(input);

    expect(result).toHaveLength(input.length);
    expect([...result].sort((a, b) => a - b)).toEqual([...input].sort((a, b) => a - b));
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('createBoard', () => {
  it.each([4, 6, 16, 36])('creates %i cards with each symbol appearing exactly twice', (boardSize) => {
    const board = createBoard(boardSize);

    expect(board).toHaveLength(boardSize);
    expect(board.every((card) => card.matched === false)).toBe(true);

    const symbolCounts = new Map<string, number>();
    for (const card of board) {
      symbolCounts.set(card.symbol, (symbolCounts.get(card.symbol) ?? 0) + 1);
    }
    for (const count of symbolCounts.values()) {
      expect(count).toBe(2);
    }
  });

  it.each([3, 5, 2, 38, -4, 0])('rejects invalid boardSize %i', (boardSize) => {
    expect(() => createBoard(boardSize)).toThrow(InvalidBoardSizeError);
  });
});
