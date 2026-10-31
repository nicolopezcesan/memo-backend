export class GameEngineError extends Error {}

export class InvalidBoardSizeError extends GameEngineError {
  constructor(boardSize: number) {
    super(`boardSize must be an even number between 4 and 36, got ${boardSize}`);
  }
}

export class InvalidCardIndexError extends GameEngineError {
  constructor(cardIndex: number) {
    super(`Invalid card index: ${cardIndex}`);
  }
}

export class CardAlreadyMatchedError extends GameEngineError {
  constructor(cardIndex: number) {
    super(`Card at index ${cardIndex} is already matched`);
  }
}

export class NotPlayersTurnError extends GameEngineError {
  constructor(playerId: string) {
    super(`It is not player ${playerId}'s turn`);
  }
}
