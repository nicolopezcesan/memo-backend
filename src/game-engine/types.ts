export interface Card {
  symbol: string;
  matched: boolean;
}

export interface PlayerState {
  playerId: string;
  nickname: string;
  score: number;
  connected: boolean;
  sessionId: string;
}

export type RoomStatus = 'waiting' | 'playing' | 'finished';

export interface RoomState {
  code: string;
  status: RoomStatus;
  boardSize: number;
  deck: Card[];
  flippedIndices: number[];
  currentTurnPlayerId: string;
  players: PlayerState[];
  createdAt: number;
}
