export class RoomFullError extends Error {
  constructor(code: string) {
    super(`Room ${code} is full`);
  }
}
