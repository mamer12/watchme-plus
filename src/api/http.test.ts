import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CACHE_PREFIX, clearMemoryCache, fetchJson, parseBody } from './http';
import { memoryStore } from '../lib/storage';

const noSleep = async () => {};
const ok = (body: string) => new Response(body, { status: 200 });

describe('http', () => {
  beforeEach(() => clearMemoryCache());

  it('API-008: retries up to 3 times with growing backoff and treats HTML as a failure', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('oops', { status: 502 }))
      .mockResolvedValueOnce(ok('<html>maintenance</html>'))
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(ok('[{"nb":"1"}]'));
    const delays: number[] = [];
    const v = await fetchJson('https://x/retry', {
      fetchImpl,
      store: memoryStore(),
      sleep: async (ms) => void delays.push(ms),
    });
    expect(v).toEqual([{ nb: '1' }]);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(delays).toEqual([400, 800, 1600]);
    expect(() => parseBody('')).toThrow();
    expect(parseBody('﻿{"a":1}')).toEqual({ a: 1 });
  });

  it('API-009: serves the last good answer when the API keeps failing', async () => {
    const store = memoryStore();
    await fetchJson('https://x/cache', { fetchImpl: async () => ok('{"v":1}'), store, sleep: noSleep });
    expect(store.getItem(CACHE_PREFIX + 'https://x/cache')).toContain('"v":1');
    clearMemoryCache();
    const failing = vi.fn<typeof fetch>(async () => new Response('down', { status: 500 }));
    await expect(fetchJson('https://x/cache', { fetchImpl: failing, store, sleep: noSleep })).resolves.toEqual({ v: 1 });
    clearMemoryCache();
    await expect(fetchJson('https://x/never', { fetchImpl: failing, store, sleep: noSleep })).rejects.toThrow();
  });

  it('API-013: shares one request between simultaneous callers and memoizes answers', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => ok('{"n":1}'));
    const store = memoryStore();
    const [a, b] = await Promise.all([fetchJson('https://x/dedupe', { fetchImpl, store }), fetchJson('https://x/dedupe', { fetchImpl, store })]);
    await fetchJson('https://x/dedupe', { fetchImpl, store });
    expect(a).toEqual(b);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('API-014: never persists answers fetched with persist: false (signed video/subtitle links)', async () => {
    const store = memoryStore();
    await fetchJson('https://x/files', { fetchImpl: async () => ok('[1]'), store, persist: false });
    expect(store.length).toBe(0);
  });
});
