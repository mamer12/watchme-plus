/** Answers one media range request with several parallel range fetches. Environment injected: tested under Node. */
import { isExpiring } from './signedUrl';
import { PF_TIMING, isLinkExpiredStatus, timeoutError } from './parallelPolicy';
import {
  PF,
  fileHostUrl,
  abortError,
  clampSpan,
  createLimiter,
  orderedPieceStream,
  parseRange,
  splitSpan,
  type ByteRange,
} from './parallelRange';

export interface FetcherDeps {
  fetch: typeof fetch;
  now?: () => number;
  /** Shared by every request, so the origin never has more than PF.MAX_CONNECTIONS media connections open. */
  limit?: ReturnType<typeof createLimiter>;
  /** Allowances (tests shorten them): headers of a piece, and silence between two chunks of its body. */
  connectMs?: number;
  stallMs?: number;
}

interface FileInfo {
  url: string;
  total: number;
  type: string;
}

export interface MediaRequest {
  url: string;
  range: string | null;
  signal: AbortSignal;
}

const OK_STATUS = 206;

/**
 * Same bytes, with `onEnd` called once when the stream finishes, fails or is cancelled. A body that stays silent for
 * `stallMs` fails with a timeout (and `onStall` aborts its connection) so the piece can be retried.
 */
function tapStream(
  body: ReadableStream<Uint8Array> | null,
  onEnd: () => void,
  stallMs: number,
  onStall: () => void,
): ReadableStream<Uint8Array> | null {
  if (!body) {
    onEnd();
    return null;
  }
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(c) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const stalled = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            onStall();
            reject(timeoutError('stall'));
          }, stallMs);
        });
        const { done, value } = await Promise.race([reader.read(), stalled]);
        if (done) {
          onEnd();
          c.close();
        } else c.enqueue(value);
      } catch (e) {
        onEnd();
        c.error(e);
      } finally {
        clearTimeout(timer);
      }
    },
    cancel(reason) {
      onEnd();
      return reader.cancel(reason);
    },
  });
}

/** `res` with another body (headers and status kept). */
const withBody = (res: Response, body: ReadableStream<Uint8Array> | null): Response =>
  new Response(body, { status: res.status, headers: res.headers });

export function createParallelFetcher(deps: FetcherDeps) {
  const doFetch = deps.fetch;
  const now = deps.now ?? Date.now;
  const limit = deps.limit ?? createLimiter(PF.MAX_CONNECTIONS);
  const connectMs = deps.connectMs ?? PF_TIMING.CONNECT_MS;
  const stallMs = deps.stallMs ?? PF_TIMING.STALL_MS;
  /** original link -> the file host URL that answered a HEAD, with the file size and type. */
  const files = new Map<string, FileInfo>();

  /**
   * The mirror's 302 can't be followed from here (it carries no CORS headers) and its Content-Range isn't exposed, so
   * the signed link is pointed at a file host directly (any `cndwN` serves it) and the size comes from a HEAD's
   * Content-Length. Hosts are tried from a per-file stable pick, so a file keeps hitting the same one.
   */
  async function resolveFile(original: string, signal: AbortSignal): Promise<FileInfo | null> {
    const known = files.get(original);
    if (known && !isExpiring(known.url, now())) return known;
    files.delete(original);
    for (let i = 0; i < PF.HOST_TRIES; i++) {
      const url = fileHostUrl(original, i);
      if (!url) return null;
      try {
        const res = await doFetch(url, { method: 'HEAD', mode: 'cors', credentials: 'omit', cache: 'no-store', signal });
        const size = Number(res.headers.get('content-length'));
        if (res.ok && Number.isSafeInteger(size) && size > 0) {
          const type = res.headers.get('content-type') ?? '';
          const info = { url, total: size, type: type.startsWith('video/') ? type : 'video/mp4' };
          files.set(original, info);
          return info;
        }
        if (isLinkExpiredStatus(res.status)) return null;
      } catch (e) {
        if (signal.aborted) throw e;
      }
    }
    return null;
  }

  /**
   * One piece, one connection. The connection slot is held until the body has been read, cancelled or failed, so the
   * limit counts downloads, not just request headers. 416 means the piece starts past the end of the file: empty.
   */
  const fetchPiece = (original: string, info: FileInfo, range: ByteRange, signal: AbortSignal): Promise<Response | null> =>
    new Promise((resolve, reject) => {
      limit(async () => {
        if (signal.aborted) throw abortError();
        // Its own controller: a timeout drops this connection only, the browser's cancel drops it too (via `signal`).
        const mine = new AbortController();
        const onAbort = () => mine.abort(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
        const connect = setTimeout(() => mine.abort(timeoutError('connect')), connectMs);
        let res: Response;
        try {
          res = await doFetch(info.url, {
            headers: { Range: `bytes=${range.start}-${range.end}` },
            mode: 'cors',
            credentials: 'omit',
            cache: 'no-store',
            signal: mine.signal,
          });
        } catch (e) {
          signal.removeEventListener('abort', onAbort);
          // A fetch that fails because we aborted it reports our reason (or an AbortError): make it a timeout.
          throw signal.aborted ? e : mine.signal.aborted ? timeoutError('connect') : e;
        } finally {
          clearTimeout(connect);
        }
        if (res.status === 416) {
          signal.removeEventListener('abort', onAbort);
          void res.body?.cancel().catch(() => {});
          resolve(null);
          return;
        }
        if (res.status !== OK_STATUS) {
          signal.removeEventListener('abort', onAbort);
          void res.body?.cancel().catch(() => {});
          if (isLinkExpiredStatus(res.status)) files.delete(original);
          throw Object.assign(new Error(`piece ${res.status}`), { status: res.status });
        }
        let release!: () => void;
        const held = new Promise<void>((r) => (release = r));
        const end = () => {
          signal.removeEventListener('abort', onAbort);
          release();
        };
        resolve(withBody(res, tapStream(res.body, end, stallMs, () => mine.abort(timeoutError('stall')))));
        await held;
      }, signal).catch(reject);
    });

  /**
   * The 206 answer, or null when the caller should just `fetch(event.request)`: not a range we split, the size or the
   * first piece unavailable twice, or the server ignored the range.
   */
  async function respond(req: MediaRequest): Promise<Response | null> {
    const asked = parseRange(req.range);
    if (!asked) return null;
    const info = await resolveFile(req.url, req.signal);
    if (!info) return null;
    const span = clampSpan(asked.start, asked.end, info.total);
    if (!span) return null;
    const ranges = splitSpan(span);

    // Piece 0 before answering, so a failure can still fall back to the plain request.
    let first: Response | null = null;
    for (let attempt = 0; attempt <= PF.RETRIES; attempt++) {
      try {
        first = await fetchPiece(req.url, info, ranges[0]!, req.signal);
        break;
      } catch (e) {
        if (req.signal.aborted) throw e;
        if (attempt === PF.RETRIES) return null;
      }
    }
    if (!first) return null;

    const stream = orderedPieceStream(
      ranges,
      async (range, signal) => ({ body: (await fetchPiece(req.url, info, range, signal))?.body ?? null }),
      req.signal,
      PF.RETRIES,
      { index: 0, body: first.body },
      // Last resort for a piece that keeps failing: one plain request for what is left, not a failed response.
      async (range, signal) => ({ body: (await fetchPiece(req.url, info, range, signal))?.body ?? null }),
    );

    return new Response(stream, {
      status: 206,
      headers: {
        'Content-Type': info.type,
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${span.start}-${span.end}/${info.total}`,
        'Content-Length': String(span.end - span.start + 1),
        'Cache-Control': 'no-store',
      },
    });
  }

  return { respond, files };
}
