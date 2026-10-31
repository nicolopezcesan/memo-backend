export class RoomFullError extends Error {
  constructor(code: string) {
    super(`Room ${code} is full`);
  }
}

export class RoomNotFoundError extends Error {
  constructor(code: string) {
    super(`Room ${code} not found`);
  }
}
