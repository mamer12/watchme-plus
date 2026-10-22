import { fileHostUrl } from './parallelRange';

/** Signed CDN links: when they expire, and the final URL behind a redirect. */

/** Expiry in ms since epoch from `Expires=<unix seconds>` (S3 style) or `X-Amz-Expires`/`X-Amz-Date`; null if unsigned. */
export function signedUrlExpiry(link: string): number | null {
  try {
    const q = new URL(link).searchParams;
    const e = q.get('Expires');
    if (e && /^\d{9,11}$/.test(e)) return Number(e) * 1000;
    const date = q.get('X-Amz-Date');
    const ttl = q.get('X-Amz-Expires');
    const m = date ? /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(date) : null;
    if (m && ttl && /^\d+$/.test(ttl)) {
      const [y, mo, d, h, mi, se] = m.slice(1).map(Number) as [number, number, number, number, number, number];
      return Date.UTC(y, mo - 1, d, h, mi, se) + Number(ttl) * 1000;
    }
  } catch {
    /* not a URL */
  }
  return null;
}

/** True when the link is signed and expires within `marginMs` (unsigned links never expire as far as we can tell). */
export function isExpiring(link: string, now = Date.now(), marginMs = 10 * 60_000): boolean {
  const exp = signedUrlExpiry(link);
  return exp !== null && exp - now < marginMs;
}

interface Resolved {
  final: string;
  at: number;
}
const resolved = new Map<string, Resolved>();
const pending = new Map<string, Promise<string>>();

/** The already-resolved final URL for `link`, if still good; else `link` itself. Synchronous, for render time. */
export function resolvedUrl(link: string, now = Date.now()): string {
  const r = resolved.get(link);
  return r && !isExpiring(r.final, now) ? r.final : link;
}

export interface WarmOptions {
  /** The service worker will rewrite the video's address itself: hand back the original link, not the file host's. */
  keepLink?: boolean;
}

/**
 * Warms the connection to the file behind `link` with a 1-byte range request. The page never asks the redirecting `cdn.`
 * host (its 302 has no CORS headers, so the browser blocks it and logs an error): the same path and query go to the
 * `cndwN.` file host the service worker uses, which answers directly with CORS headers. Anything else, and every
 * failure, is ignored silently and gives back `link`.
 */
export function warmUrl(link: string, fetchImpl: typeof fetch = fetch, now = Date.now(), opts: WarmOptions = {}): Promise<string> {
  const known = resolved.get(link);
  if (known && !isExpiring(known.final, now)) return Promise.resolve(known.final);
  const running = pending.get(link);
  if (running) return running;
  const target = fileHostUrl(link);
  if (!target) return Promise.resolve(link);
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 8000) : null;
  const init = { headers: { Range: 'bytes=0-0' }, mode: 'cors', cache: 'no-store', credentials: 'omit', priority: 'low', signal: ctrl?.signal } as RequestInit;
  const p = Promise.resolve()
    .then(() => fetchImpl(target, init))
    .then((res) => {
      void res.body?.cancel().catch(() => {});
      const fileUrl = res.ok && res.url && res.url.startsWith('https://') ? res.url : target;
      const final = res.ok ? (opts.keepLink ? link : fileUrl) : link;
      resolved.set(link, { final, at: now });
      return final;
    })
    .catch(() => link)
    .finally(() => {
      if (timer) clearTimeout(timer);
      pending.delete(link);
    });
  pending.set(link, p);
  return p;
}

/** For tests. */
export function clearWarmedUrls(): void {
  resolved.clear();
  pending.clear();
}
