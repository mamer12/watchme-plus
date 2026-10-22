/**
 * Service worker add-on (bundled to /pf-sw.js and importScripts'd by the generated worker): answers the mirror's
 * video range requests with parallel range fetches. Off until the page says the provider is "Other".
 */
import { createParallelFetcher } from '../lib/parallelFetcher';
import { isMirrorMediaHost, parseRange } from '../lib/parallelRange';
import { PF_CACHE, PF_STATE_URL, PF_STAT_MESSAGE, isPfMessage } from '../lib/pfState';

/** Kill switch: ship `true` (and redeploy) to turn the feature off for everyone, whatever the pages say. */
const KILL_SWITCH = false;

interface FetchEventLike extends Event {
  request: Request;
  respondWith(r: Promise<Response>): void;
}
interface MessageEventLike extends Event {
  data: unknown;
  waitUntil(p: Promise<unknown>): void;
}
const swScope = self as unknown as { clients: { matchAll(): Promise<{ postMessage(m: unknown): void }[]> } };
const MIN_STAT_BYTES = 512 * 1024;

/** Tells the pages how fast a video response came in (the quality controller's throughput). */
function withStats(res: Response): Response {
  if (!res.body) return res;
  const t0 = Date.now();
  let bytes = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, c) {
      bytes += chunk.byteLength;
      c.enqueue(chunk);
    },
    flush() {
      const ms = Date.now() - t0;
      if (bytes >= MIN_STAT_BYTES && ms > 0) {
        void swScope.clients
          .matchAll()
          .then((cs) => cs.forEach((c) => c.postMessage({ type: PF_STAT_MESSAGE, bytes, ms })))
          .catch(() => {});
      }
    },
  });
  return new Response(res.body.pipeThrough(counter), { status: res.status, headers: res.headers });
}

const sw = self as unknown as {
  addEventListener(type: 'fetch', l: (e: FetchEventLike) => void): void;
  addEventListener(type: 'message', l: (e: MessageEventLike) => void): void;
};

// The worker is stopped and restarted at will, so the page's choice is kept in the Cache API and read back lazily.
let enabled = false;
const ready: Promise<void> = caches
  .open(PF_CACHE)
  .then((c) => c.match(PF_STATE_URL))
  .then(async (r) => {
    enabled = r ? (await r.text()) === '1' : false;
  })
  .catch(() => {});

const fetcher = createParallelFetcher({ fetch: (i, o) => fetch(i, o) });

sw.addEventListener('message', (e) => {
  if (!isPfMessage(e.data)) return;
  const on = e.data.on;
  enabled = on;
  e.waitUntil(caches.open(PF_CACHE).then((c) => c.put(PF_STATE_URL, new Response(on ? '1' : '0'))).catch(() => {}));
});

sw.addEventListener('fetch', (e) => {
  const req = e.request;
  const range = req.headers.get('range');
  if (KILL_SWITCH || !range || req.method !== 'GET' || !parseRange(range)) return;
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (!isMirrorMediaHost(url.hostname)) return;
  e.respondWith(
    (async () => {
      await ready;
      if (!enabled) return fetch(req);
      try {
        const res = await fetcher.respond({ url: req.url, range, signal: req.signal });
        if (res) return withStats(res);
      } catch (err) {
        if (req.signal.aborted) throw err;
      }
      return fetch(req);
    })(),
  );
});
