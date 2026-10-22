import { describe, expect, it } from 'vitest';
import type { VideoFile } from '../api/types';
import { mirror, hostsFor } from '../api/endpoints';
import { fileHostUrl } from './parallelRange';
import { IMAGE_CACHE, pwaOptions } from '../../pwa.config';
import { QUERY_STALE_MS } from '../hooks/useQuery';
import {
  bufferedAhead,
  isAdaptive,
  readWorkingQuality,
  startFile,
  writeWorkingQuality,
} from './adaptiveQuality';
import { pickImage, slotQueue } from './imageVariant';
import { isExpiring, signedUrlExpiry, warmUrl, resolvedUrl, clearWarmedUrls } from './signedUrl';

const f = (h: number): VideoFile => ({ resolution: `${h}p`, height: h, url: `https://cdn.example/${h}.mp4` });
const ALL = [240, 360, 480, 720, 1080, 2160].map(f);

describe('start quality', () => {
  it('PERF-001: starts at 480p on the mirror, else the lowest of at least 360p, else the lowest', () => {
    expect(startFile(ALL)?.height).toBe(480);
    expect(startFile([f(240), f(360), f(720)])?.height).toBe(360);
    expect(startFile([f(240), f(720)])?.height).toBe(720);
    expect(startFile([f(240)])?.height).toBe(240);
    expect(startFile([])).toBeNull();
    expect(isAdaptive('other')).toBe(true);
    expect(isAdaptive('el')).toBe(false);
  });

  it('PERF-001: EL starts at the highest file up to 720p; the cap is never exceeded', () => {
    expect(startFile(ALL, null, 'el')?.height).toBe(720);
    expect(startFile([f(240), f(480), f(1080)], null, 'el')?.height).toBe(480);
    expect(startFile([f(1080)], null, 'el')?.height).toBe(1080);
    expect(startFile(ALL, '1080p', 'other', 720)?.height).toBe(480);
    expect(startFile(ALL, '720p', 'other', 480)?.height).toBe(480);
  });

  it('PERF-001: the remembered quality is only the starting point', () => {
    expect(startFile(ALL, '360p')?.height).toBe(360);
    expect(startFile(ALL, '999p')?.height).toBe(480);
    expect(startFile(ALL, '1080p', 'el')?.height).toBe(1080);
  });

  it('PERF-001: remembers the working quality per provider and measures buffered-ahead', () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(readWorkingQuality('other', store)).toBeNull();
    writeWorkingQuality('other', '360p', store);
    expect(readWorkingQuality('other', store)).toBe('360p');
    expect(readWorkingQuality('el', store)).toBeNull();
    mem.set('wmp:aq:el', 'junk');
    expect(readWorkingQuality('el', store)).toBeNull();
    const ranges = { length: 2, start: (i: number) => [0, 100][i]!, end: (i: number) => [30, 160][i]! };
    expect(bufferedAhead(ranges, 10)).toBe(20);
    expect(bufferedAhead(ranges, 120)).toBe(40);
    expect(bufferedAhead(ranges, 60)).toBe(0);
  });
});

describe('signed urls', () => {
  const link = 'https://cndw1.example/a.mp4?x=1&Expires=1793135004&Signature=abc';
  it('PERF-002: reads the expiry of signed links', () => {
    expect(signedUrlExpiry(link)).toBe(1793135004 * 1000);
    expect(signedUrlExpiry('https://h/a.mp4?X-Amz-Date=20260101T000000Z&X-Amz-Expires=3600')).toBe(Date.UTC(2026, 0, 1, 1));
    expect(signedUrlExpiry('https://h/a.mp4')).toBeNull();
    expect(signedUrlExpiry('not a url')).toBeNull();
  });

  it('PERF-002: treats a link as expiring inside the margin only', () => {
    const exp = 1793135004 * 1000;
    expect(isExpiring(link, exp - 60 * 60_000)).toBe(false);
    expect(isExpiring(link, exp - 60_000)).toBe(true);
    expect(isExpiring(link, exp + 1)).toBe(true);
    expect(isExpiring('https://h/a.mp4', exp)).toBe(false);
  });

  it('PERF-002: warm-up asks the file host (never cdn.), once, and reuses the answer', async () => {
    clearWarmedUrls();
    const cdn = mirror().mediaHosts![0]!;
    const first = `https://${cdn}/vascin24-mp4/v.mp4?Expires=1793135004&Signature=z`;
    const expected = fileHostUrl(first)!;
    const asked: string[] = [];
    const fake = (async (u: string, init?: RequestInit) => {
      asked.push(u);
      expect((init?.headers as Record<string, string>).Range).toBe('bytes=0-0');
      expect(init?.mode).toBe('cors');
      expect(init?.cache).toBe('no-store');
      expect((init as { priority?: string }).priority).toBe('low');
      return { ok: true, url: u, body: null } as unknown as Response;
    }) as unknown as typeof fetch;
    const now = 1793135004 * 1000 - 24 * 3600_000;
    expect(resolvedUrl(first, now)).toBe(first);
    expect(await warmUrl(first, fake, now)).toBe(expected);
    expect(await warmUrl(first, fake, now)).toBe(expected);
    expect(asked).toEqual([expected]);
    expect(new URL(expected).host).toMatch(/^cndw[1-6]\./);
    expect(new URL(expected).search).toBe(new URL(first).search);
    expect(resolvedUrl(first, now)).toBe(expected);
    // Close to expiry the cached address is dropped.
    expect(resolvedUrl(first, 1793135004 * 1000 - 60_000)).toBe(first);
  });

  it('PERF-002: warm-up keeps the original link when the service worker rewrites it, and the same file keeps its host', async () => {
    clearWarmedUrls();
    const link = `https://${mirror().mediaHosts![0]!}/vascin24-mp4/k.mp4?Expires=1793135004`;
    const fake = (async (u: string) => ({ ok: true, url: u, body: null }) as unknown as Response) as unknown as typeof fetch;
    expect(await warmUrl(link, fake, 0, { keepLink: true })).toBe(link);
    expect(fileHostUrl(link)).toBe(fileHostUrl(link));
  });

  it('PERF-002: warm-up swallows errors and refusals, and never requests a host it cannot rewrite', async () => {
    clearWarmedUrls();
    const link = `https://${mirror().mediaHosts![0]!}/a/b.mp4?Expires=1793135004`;
    let calls = 0;
    const boom = (async () => {
      calls++;
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await warmUrl(link, boom, 0)).toBe(link);
    clearWarmedUrls();
    const refused = (async () => ({ ok: false, url: '', body: null }) as unknown as Response) as unknown as typeof fetch;
    expect(await warmUrl(link, refused, 0)).toBe(link);
    clearWarmedUrls();
    const never = (async () => {
      calls++;
      return {} as Response;
    }) as unknown as typeof fetch;
    const before = calls;
    expect(await warmUrl('https://cdn.example/x.mp4', never, 0)).toBe('https://cdn.example/x.mp4');
    expect(await warmUrl('http://' + mirror().mediaHosts![0]! + '/x.mp4', never, 0)).toBe('http://' + mirror().mediaHosts![0]! + '/x.mp4');
    expect(calls).toBe(before);
  });

  it('PERF-002: the cdn host maps to a stable cndwN file host with the same path and query, and attempts move on', () => {
    const link = `https://${mirror().mediaHosts![0]!}/vascin24-mp4/a b.mp4?response-content-disposition=x&AWSAccessKeyId=k&Expires=1&Signature=s%2B`;
    const a = fileHostUrl(link)!;
    expect(fileHostUrl(link)).toBe(a);
    expect(new URL(a).pathname).toBe(new URL(link).pathname);
    expect(new URL(a).search).toBe(new URL(link).search);
    expect(new URL(fileHostUrl(link, 1)!).host).not.toBe(new URL(a).host);
    expect(fileHostUrl(a)).toBe(a);
    expect(fileHostUrl('https://example.com/x.mp4')).toBeNull();
  });
});

describe('images', () => {
  const t = { poster: 'big.jpg', posterThumb: 'medium.jpg', cover: 'cover.jpg' };
  it('PERF-004: cards use the small poster, the hero the cover', () => {
    expect(pickImage(t, 'card')).toEqual({ src: 'medium.jpg', fallback: 'big.jpg' });
    expect(pickImage(t, 'hero')).toEqual({ src: 'cover.jpg', fallback: 'big.jpg' });
    expect(pickImage({ ...t, posterThumb: null }, 'card')).toEqual({ src: 'big.jpg', fallback: null });
    expect(pickImage({ poster: null, posterThumb: null, cover: null }, 'card').src).toBeNull();
    expect(pickImage({ ...t, cover: null }, 'hero').src).toBe('big.jpg');
  });

  it('PERF-005: lets only a few images download at once, in order', () => {
    const q = slotQueue(() => 2);
    const log: string[] = [];
    const r1 = q.acquire(() => log.push('a'));
    q.acquire(() => log.push('b'));
    const r3 = q.acquire(() => log.push('c'));
    expect(log).toEqual(['a', 'b']);
    r1();
    r1();
    expect(log).toEqual(['a', 'b', 'c']);
    expect(q.active).toBe(2);
    r3();
    expect(q.active).toBe(1);
    const cancel = q.acquire(() => log.push('d'));
    q.acquire(() => log.push('e'));
    cancel();
    expect(log).toContain('d');
  });
});

describe('caching and hints', () => {
  it('PERF-007: caches images from both hosts cache-first with the agreed limits', () => {
    expect(IMAGE_CACHE).toMatchObject({ maxEntries: 300, maxAgeSeconds: 30 * 86400, statuses: [0, 200] });
    const rule = pwaOptions.workbox?.runtimeCaching?.find((r) => r.options?.cacheName === IMAGE_CACHE.name);
    expect(rule?.handler).toBe('CacheFirst');
    expect(rule?.options?.expiration?.maxEntries).toBe(300);
    expect(rule?.options?.cacheableResponse?.statuses).toEqual([0, 200]);
    const match = rule?.urlPattern as (o: { url: URL; request: { destination: string } }) => boolean;
    const image = (host: string) => match({ url: new URL(`https://${host}/a.jpg`), request: { destination: 'image' } });
    expect(image('cnth2.cee.buzz')).toBe(true);
    expect(image(hostsFor('el')[1]!)).toBe(true);
    expect(image('cdn.cee.buzz')).toBe(false);
    expect(match({ url: new URL('https://cnth2.cee.buzz/a.mp4'), request: { destination: 'video' } })).toBe(false);
  });

  it('PERF-008: hints cover only the active provider’s hosts', () => {
    expect(hostsFor('other')).toEqual(['cee.buzz', 'cnth2.cee.buzz', 'cdn.cee.buzz']);
    expect(hostsFor('el').some((h) => h.includes('cee.buzz'))).toBe(false);
  });

  it('PERF-009: reuses catalog answers for a few minutes', () => {
    expect(QUERY_STALE_MS).toBeGreaterThanOrEqual(5 * 60_000);
    expect(QUERY_STALE_MS).toBeLessThanOrEqual(10 * 60_000);
  });
});
