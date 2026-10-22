/**
 * Parallel range fetching, pure part. The mirror throttles each connection, so one video range is split into a few
 * pieces fetched side by side and handed back in order. The service worker (`src/sw/pfSw.ts`) wires this to `fetch`.
 * No DOM or worker globals here: everything the logic needs is injected, so it runs under Node tests.
 */
import { mirror } from '../api/endpoints';
import { pieceFailureAction, remainingSpan } from './parallelPolicy';

export const PF = {
  /** Most bytes answered per response; the browser asks for the next range itself. */
  MAX_RESPONSE_BYTES: 8 * 1024 * 1024,
  PIECES: 4,
  /** Connections open at once across the whole origin. */
  MAX_CONNECTIONS: 8,
  /** Retries of a failed piece before giving up on it. */
  RETRIES: 1,
  /** `cndw1`..`cndwN` file hosts the mirror serves signed links from. */
  FILE_HOSTS: 6,
  /** File hosts tried, in order, before giving up on parallel fetching for a file. */
  HOST_TRIES: 2,
} as const;

export interface ByteRange {
  start: number;
  /** Inclusive. */
  end: number;
}

/** `bytes=a-b` or `bytes=a-` (end null). Suffix (`-n`), multi-range and malformed values give null: not ours to split. */
export function parseRange(header: string | null | undefined): { start: number; end: number | null } | null {
  const m = /^\s*bytes\s*=\s*(\d+)\s*-\s*(\d*)\s*$/i.exec(header ?? '');
  if (!m) return null;
  const start = Number(m[1]);
  const end = m[2] ? Number(m[2]) : null;
  if (!Number.isSafeInteger(start) || (end !== null && (!Number.isSafeInteger(end) || end < start))) return null;
  return { start, end };
}

/** The span to answer: at most `max` bytes from `start`, and not past the last byte when the size is known. */
export function clampSpan(start: number, end: number | null, total: number | null = null, max: number = PF.MAX_RESPONSE_BYTES): ByteRange | null {
  let last = start + max - 1;
  if (end !== null) last = Math.min(last, end);
  if (total !== null) {
    if (start >= total) return null;
    last = Math.min(last, total - 1);
  }
  return { start, end: last };
}

/** `parts` consecutive pieces covering the span exactly; sizes differ by at most one byte, none is empty. */
export function splitSpan(span: ByteRange, parts: number = PF.PIECES): ByteRange[] {
  const length = span.end - span.start + 1;
  const n = Math.max(1, Math.min(parts, length));
  const base = Math.floor(length / n);
  const extra = length % n;
  const out: ByteRange[] = [];
  let at = span.start;
  for (let i = 0; i < n; i++) {
    const size = base + (i < extra ? 1 : 0);
    out.push({ start: at, end: at + size - 1 });
    at += size;
  }
  return out;
}

/** `bytes a-b/total` (or `*` total) from a Content-Range header. */
export function parseContentRange(header: string | null | undefined): { start: number; end: number; total: number | null } | null {
  const m = /^\s*bytes\s+(\d+)\s*-\s*(\d+)\s*\/\s*(\d+|\*)\s*$/i.exec(header ?? '');
  if (!m) return null;
  return { start: Number(m[1]), end: Number(m[2]), total: m[3] === '*' ? null : Number(m[3]) };
}

/** Whether a host serves the mirror's video files: the redirecting `cdn.` host or a signed `cndwN.` file host. */
export function isMirrorMediaHost(hostname: string, base: string = mirror().host ?? ''): boolean {
  const h = hostname.toLowerCase();
  const media = mirror().mediaHosts ?? [];
  if (media.includes(h)) return true;
  const suffix = `.${base}`;
  return h.endsWith(suffix) && /^cndw\d*$/.test(h.slice(0, -suffix.length));
}

/**
 * The same signed link on a file host: `cdn.` (which only redirects) becomes `cndwN.`, N picked from the file's path so a
 * file sticks to one host; `attempt` moves to the next host. Links already on a file host are returned as they are.
 */
export function fileHostUrl(link: string, attempt = 0, base: string = mirror().host ?? ''): string | null {
  try {
    const u = new URL(link);
    if (u.protocol !== 'https:') return null;
    if (/^cndw\d*$/i.test(u.hostname.slice(0, -(base.length + 1))) && u.hostname.endsWith(`.${base}`)) return link;
    if (!(mirror().mediaHosts ?? []).includes(u.hostname.toLowerCase())) return null;
    let h = 0;
    for (const ch of u.pathname) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    u.hostname = `cndw${((h + attempt) % PF.FILE_HOSTS) + 1}.${base}`;
    return u.toString();
  } catch {
    return null;
  }
}

/** The kill switch and the page's choice, in one place: parallel fetching runs only when both agree. */
export function shouldParallelize(o: { killed: boolean; providerOther: boolean; hostname: string; range: string | null }): boolean {
  if (o.killed || !o.providerOther || !isMirrorMediaHost(o.hostname)) return false;
  return parseRange(o.range) !== null;
}

// ---- concurrency --------------------------------------------------------------------------------

/** At most `max` tasks at once, FIFO. A task whose `signal` aborted while it waited never starts. */
export function createLimiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const release = () => {
    active -= 1;
    queue.shift()?.();
  };
  return function run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        if (signal?.aborted) {
          reject(abortError());
          queue.shift()?.();
          return;
        }
        active += 1;
        task().then(resolve, reject).finally(release);
      };
      if (active < max) start();
      else queue.push(start);
    });
  };
}

export const abortError = (): Error => Object.assign(new Error('aborted'), { name: 'AbortError' });

// ---- ordered stream -----------------------------------------------------------------------------

/** What a piece fetch gives back: a body for `range` (possibly shorter if the file ends inside it). */
export interface PieceBody {
  body: ReadableStream<Uint8Array> | null;
}

export type OpenPiece = (range: ByteRange, signal: AbortSignal) => Promise<PieceBody>;

interface Piece {
  range: ByteRange;
  chunks: Uint8Array[];
  received: number;
  done: boolean;
  error: unknown;
  wake: (() => void) | null;
}

/**
 * Starts every piece at once (`open` decides how many really run: the limiter lives inside it) and returns a stream
 * that emits them in order: piece 0 as soon as it has bytes, piece 1 after piece 0 ended, and so on. A piece whose
 * connection drops or times out is reopened from the byte it reached, `retries` times. If it still fails and a
 * `fallback` is given, the other pieces are dropped and one plain request supplies the rest of the span, so one bad
 * connection never fails the response while bytes can still be had; only then the stream errors. `signal` aborts all
 * (the browser cancelled the request: nothing is retried).
 * Pieces that were only partly filled by the server (EOF) simply end short; the stream ends with the last piece.
 */
export function orderedPieceStream(
  ranges: ByteRange[],
  open: OpenPiece,
  signal: AbortSignal,
  retries: number = PF.RETRIES,
  prefetched?: { index: number; body: ReadableStream<Uint8Array> | null },
  fallback?: OpenPiece,
): ReadableStream<Uint8Array> {
  const own = new AbortController();
  const stop = () => own.abort();
  if (signal.aborted) own.abort();
  else signal.addEventListener('abort', stop, { once: true });

  const pieces: Piece[] = ranges.map((range) => ({ range, chunks: [], received: 0, done: false, error: null, wake: null }));
  /** One controller per piece, so the pieces after a failed one can be dropped without touching the rest. */
  const stops = new Map<Piece, AbortController>();

  const pump = async (p: Piece, first: ReadableStream<Uint8Array> | null | undefined, opener: OpenPiece, tries: number) => {
    const mine = new AbortController();
    stops.set(p, mine);
    const onOwn = () => mine.abort();
    own.signal.addEventListener('abort', onOwn, { once: true });
    let attempts = 0;
    let body = first;
    try {
      for (;;) {
        try {
          if (body === undefined) {
            const r = await opener({ start: p.range.start + p.received, end: p.range.end }, mine.signal);
            body = r.body;
          }
          if (body) {
            const reader = body.getReader();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value && value.byteLength) {
                p.chunks.push(value);
                p.received += value.byteLength;
                p.wake?.();
              }
            }
          }
          break;
        } catch (e) {
          // A dropped piece is only retried for a real failure, never because it was cancelled.
          if (mine.signal.aborted || pieceFailureAction({ aborted: own.signal.aborted, attempts, retries: tries, canFallback: false }) !== 'retry') throw e;
          attempts += 1;
          body = undefined;
        }
      }
    } catch (e) {
      p.error = e;
    }
    own.signal.removeEventListener('abort', onOwn);
    p.done = true;
    p.wake?.();
  };

  pieces.forEach((p, i) => void pump(p, prefetched && prefetched.index === i ? prefetched.body : undefined, open, retries));

  let at = 0;
  let fellBack = false;
  /** Replaces piece `at` and everything after it by one plain request for the missing bytes. */
  const fallBackFrom = (): boolean => {
    const p = pieces[at]!;
    const span = remainingSpan(ranges, at, p.received);
    if (!fallback || fellBack || !span) return false;
    fellBack = true;
    for (const later of pieces.splice(at + 1)) stops.get(later)?.abort();
    const tail: Piece = { range: span, chunks: [], received: 0, done: false, error: null, wake: null };
    pieces[at] = tail;
    void pump(tail, undefined, fallback, retries);
    return true;
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (at < pieces.length) {
        const p = pieces[at]!;
        const chunk = p.chunks.shift();
        if (chunk) {
          controller.enqueue(chunk);
          return;
        }
        if (p.error) {
          if (!own.signal.aborted && pieceFailureAction({ aborted: false, attempts: retries, retries, canFallback: !!fallback && !fellBack }) === 'fallback' && fallBackFrom()) continue;
          own.abort();
          controller.error(p.error);
          return;
        }
        if (p.done) {
          at += 1;
          continue;
        }
        await new Promise<void>((resolve) => {
          p.wake = resolve;
        });
        p.wake = null;
      }
      signal.removeEventListener('abort', stop);
      controller.close();
    },
    cancel() {
      signal.removeEventListener('abort', stop);
      own.abort();
    },
  });
}
