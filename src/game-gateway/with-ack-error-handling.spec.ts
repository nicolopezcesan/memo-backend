import { describe, expect, it } from 'vitest';
import { withAckErrorHandling } from './with-ack-error-handling.js';

describe('withAckErrorHandling', () => {
  it('returns the wrapped function result on success', async () => {
    const result = await withAckErrorHandling('test', async () => ({ ok: true }));
    expect(result).toEqual({ ok: true });
  });

  it('converts any thrown error into an INTERNAL_ERROR ack instead of propagating', async () => {
    const result = await withAckErrorHandling('test', async () => {
      throw new Error('boom');
    });

    expect(result).toMatchObject({ ok: false, code: 'INTERNAL_ERROR' });
  });
});
