export class GameError extends Error {}

export class NotHostError extends GameError {
  constructor(playerId: string) {
    super(`Player ${playerId} is not the host of this room`);
  }
}

export class GameAlreadyStartedError extends GameError {
  constructor(code: string) {
    super(`Room ${code} is not waiting to start`);
  }
}

export class NotEnoughPlayersError extends GameError {
  constructor(code: string) {
    super(`Room ${code} does not have 2 connected players yet`);
  }
}

export class GameNotStartedError extends GameError {
  constructor(code: string) {
    super(`Room ${code} is not currently playing`);
  }
}
