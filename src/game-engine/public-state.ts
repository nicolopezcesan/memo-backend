import type { PlayerState, RoomState } from './types.js';

export interface PublicCard {
  symbol: string | null;
  matched: boolean;
}

export type PublicPlayerState = Omit<PlayerState, 'sessionId'>;

export interface PublicRoomState extends Omit<RoomState, 'deck' | 'players'> {
  deck: PublicCard[];
  players: PublicPlayerState[];
}

/**
 * Strips server-internal fields before a RoomState reaches a client:
 * - the symbol of any card that isn't matched or currently flipped, so a
 *   client can never read the full board from the wire (devtools/network
 *   tab) before it's actually revealed.
 * - each player's sessionId, which is only meaningful to the Redis
 *   session:{id} mapping and has no reason to be visible to the other
 *   player in the room.
 */
export function toPublicRoomState(state: RoomState): PublicRoomState {
  return {
    ...state,
    deck: state.deck.map((card, index) => ({
      matched: card.matched,
      symbol: card.matched || state.flippedIndices.includes(index) ? card.symbol : null,
    })),
    players: state.players.map(toPublicPlayer),
  };
}

export function toPublicPlayer(player: PlayerState): PublicPlayerState {
  const { sessionId: _sessionId, ...publicPlayer } = player;
  return publicPlayer;
}
