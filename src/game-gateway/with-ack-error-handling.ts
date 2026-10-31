import { Logger } from '@nestjs/common';
import { errAck, type Ack } from './ack.js';

const logger = new Logger('GameGateway');

/**
 * Last-resort safety net around every ack-based handler.
 *
 * Nest's WS pipeline drops the response entirely when a handler throws
 * (filters it out before it ever reaches the client, see
 * @nestjs/platform-socket.io's bindMessageHandlers): the ack callback would
 * simply never fire, leaving the client's request hanging forever instead
 * of failing. A `@Catch()` ExceptionFilter doesn't fix this either - Nest's
 * default WS exception handling emits a separate 'exception' event, not the
 * ack, which is exactly what ADR 0005 says NOT to do for request/response
 * events. Catching here, inside the handler, is what actually guarantees the
 * ack always resolves.
 */
export async function withAckErrorHandling<T extends object>(
  handlerName: string,
  fn: () => Promise<Ack<T>>,
): Promise<Ack<T>> {
  try {
    return await fn();
  } catch (error) {
    logger.error(
      `Unhandled error in ${handlerName}`,
      error instanceof Error ? error.stack : String(error),
    );
    return errAck('INTERNAL_ERROR', 'Unexpected server error');
  }
}
