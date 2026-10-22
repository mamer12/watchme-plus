import { fileHostUrl } from './parallelRange';

const sizes = new Map<string, number>();

/** The file's size in bytes from a HEAD's Content-Length (via the file host, which allows CORS); null when unknown. Cached. */
export async function fetchFileSize(link: string, fetchImpl: typeof fetch = fetch): Promise<number | null> {
  const known = sizes.get(link);
  if (known) return known;
  try {
    const res = await fetchImpl(fileHostUrl(link) ?? link, { method: 'HEAD', mode: 'cors', credentials: 'omit', cache: 'no-store', priority: 'low' } as RequestInit);
    const n = Number(res.headers.get('content-length'));
    if (res.ok && Number.isSafeInteger(n) && n > 0) {
      sizes.set(link, n);
      return n;
    }
  } catch {
    /* unknown: the estimate by height is used */
  }
  return null;
}

export const knownSizes = (): ReadonlyMap<string, number> => sizes;
export const clearFileSizes = (): void => sizes.clear();

export const PROBE_BYTES = 1_000_000;

/**
 * Measures the line directly: downloads about 1 MB from the middle of `link` (through the same path the video uses) and
 * returns bytes per second, or null on any failure. A browser that buffers only a few seconds ahead never shows how fast
 * the line really is, so the controller asks before it steps up.
 */
export async function probeBandwidth(link: string, size: number | null, fetchImpl: typeof fetch = fetch, now: () => number = () => performance.now()): Promise<number | null> {
  const start = size && size > PROBE_BYTES * 4 ? Math.floor(size / 2 + Math.random() * PROBE_BYTES) : 0;
  const t0 = now();
  try {
    const res = await fetchImpl(fileHostUrl(link) ?? link, {
      headers: { Range: `bytes=${start}-${start + PROBE_BYTES - 1}` },
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
    });
    if (res.status !== 206) {
      void res.body?.cancel().catch(() => {});
      return null;
    }
    const got = (await res.arrayBuffer()).byteLength;
    const ms = now() - t0;
    return got >= PROBE_BYTES / 2 && ms > 0 ? (got / ms) * 1000 : null;
  } catch {
    return null;
  }
}
