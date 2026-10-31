import type { Socket } from 'socket.io';

export interface SocketIdentity {
  playerId: string;
  roomCode: string;
}

/**
 * playerId/roomCode are bound to the socket connection when room:create or
 * room:join succeeds (see GameGateway), not re-sent by the client on every
 * event: trusting a client-supplied playerId on room:start/card:flip would
 * let any client act as any player just by passing the right id in the
 * payload.
 */
export function bindSocketIdentity(client: Socket, identity: SocketIdentity): void {
  client.data = identity;
}

export function getSocketIdentity(client: Socket): SocketIdentity | null {
  const data = client.data as Partial<SocketIdentity> | undefined;
  if (!data?.playerId || !data.roomCode) return null;
  return { playerId: data.playerId, roomCode: data.roomCode };
}
