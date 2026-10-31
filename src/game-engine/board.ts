import type { Card } from './types.js';
import { InvalidBoardSizeError } from './errors.js';

export const MIN_BOARD_SIZE = 4;
export const MAX_BOARD_SIZE = 36;

export function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function createBoard(boardSize: number): Card[] {
  const isEven = boardSize % 2 === 0;
  const inRange = boardSize >= MIN_BOARD_SIZE && boardSize <= MAX_BOARD_SIZE;
  if (!isEven || !inRange) {
    throw new InvalidBoardSizeError(boardSize);
  }

  const pairCount = boardSize / 2;
  const cards: Card[] = [];
  for (let symbolIndex = 0; symbolIndex < pairCount; symbolIndex++) {
    cards.push({ symbol: String(symbolIndex), matched: false });
    cards.push({ symbol: String(symbolIndex), matched: false });
  }

  return shuffle(cards);
}
