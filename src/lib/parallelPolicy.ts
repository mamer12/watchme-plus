/**
 * Retry and timeout policy of the parallel fetcher, pure. The mirror can answer slowly (first byte 0.7-1.2 s, a few
 * Mbit/s per connection), so the allowances are generous: a piece that is only slow is not a failed piece.
 */
import type { ByteRange } from './parallelRange';

export const PF_TIMING = {
  /** From sending a piece request to its headers (the first byte after a seek on a slow server). */
  CONNECT_MS: 10_000,
  /** Longest a piece's body may stay silent between two chunks. */
  STALL_MS: 20_000,
} as const;

export type PieceTimeoutKind = 'connect' | 'stall';

/** A timed-out piece. Not an AbortError: an abort means the browser gave up on the request, a timeout is retried. */
export const timeoutError = (kind: PieceTimeoutKind): Error => Object.assign(new Error(`piece ${kind} timeout`), { name: 'TimeoutError' });
export const isTimeout = (e: unknown): boolean => (e as { name?: string } | null)?.name === 'TimeoutError';

export type PieceAction = 'abort' | 'retry' | 'fallback' | 'fail';

/**
 * What to do when a piece's connection failed (or timed out) after `attempts` retries already made.
 * abort: the browser cancelled the request (a seek), so nothing is retried and nothing is reported.
 * retry: reopen that piece, once, from the byte it reached. fallback: one plain request for the rest of the span.
 */
export function pieceFailureAction(o: { aborted: boolean; attempts: number; retries: number; canFallback: boolean }): PieceAction {
  if (o.aborted) return 'abort';
  if (o.attempts < o.retries) return 'retry';
  return o.canFallback ? 'fallback' : 'fail';
}

/** The bytes still missing when piece `index` stopped after `received` bytes: from there to the end of the last piece. */
export function remainingSpan(ranges: ByteRange[], index: number, received: number): ByteRange | null {
  const p = ranges[index];
  const last = ranges[ranges.length - 1];
  if (!p || !last) return null;
  const start = p.start + received;
  return start > last.end ? null : { start, end: last.end };
}

/** True for failures that mean the signed link is no longer good (the cached file host and size are dropped). */
export const isLinkExpiredStatus = (status: number): boolean => status === 403 || status === 410;
