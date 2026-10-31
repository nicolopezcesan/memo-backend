import type { RoomState } from './types.js';

export interface PublicCard {
  symbol: string | null;
  matched: boolean;
}

export interface PublicRoomState extends Omit<RoomState, 'deck'> {
  deck: PublicCard[];
}

/**
 * Strips the symbol of any card that isn't matched or currently flipped, so
 * a client can never read the full board from the wire (devtools/network
 * tab) before it's actually revealed.
 */
export function toPublicRoomState(state: RoomState): PublicRoomState {
  return {
    ...state,
    deck: state.deck.map((card, index) => ({
      matched: card.matched,
      symbol: card.matched || state.flippedIndices.includes(index) ? card.symbol : null,
    })),
  };
}
