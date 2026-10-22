import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiBase, getIsp, providerById, imageBase, ISP_KEY, isCatalogImageHost, rehostImage, resetIspForTests, setIsp } from './endpoints';
import { endpoints } from './catalog';
import { CACHE_PREFIX, clearApiCache, fetchJson, clearMemoryCache, isNetworkError } from './http';
import { catalogFailed, reportCatalogOk } from './health';
import { switchIsp } from './switchIsp';
import { url } from './parse';
import { memoryStore } from '../lib/storage';

function stubStorage() {
  const kv = memoryStore();
  vi.stubGlobal('localStorage', kv);
  resetIspForTests();
  return kv;
}

beforeEach(() => {
  clearMemoryCache();
  reportCatalogOk();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetIspForTests();
});

describe('internet provider', () => {
  it('ISP-001: EL uses the default catalog host and Other uses the mirror host over https', () => {
    expect(apiBase('el')).toBe(`https://${providerById('el')!.host}/api/android/`);
    expect(apiBase('other')).toBe('https://cee.buzz/api/android/');
    expect(apiBase('other').startsWith('https://')).toBe(true);
  });

  it('ISP-002: defaults to EL when nothing, or junk, is stored', () => {
    stubStorage();
    expect(getIsp()).toBe('el');
    localStorage.setItem(ISP_KEY, 'nonsense');
    resetIspForTests();
    expect(getIsp()).toBe('el');
  });

  it('ISP-002: still works when storage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    resetIspForTests();
    expect(getIsp()).toBe('el');
    setIsp('other');
    expect(getIsp()).toBe('other');
  });

  it('ISP-003: the choice is persisted and read back after a reload', () => {
    const kv = stubStorage();
    setIsp('other');
    expect(kv.getItem(ISP_KEY)).toBe('other');
    resetIspForTests();
    expect(getIsp()).toBe('other');
  });

  it('ISP-004: apiBase and every endpoint follow the current choice at call time', () => {
    stubStorage();
    expect(endpoints(2).banner()).toBe(`https://${providerById('el')!.host}/api/android/banner/level/2`);
    setIsp('other');
    expect(apiBase()).toBe('https://cee.buzz/api/android/');
    expect(endpoints(2).banner()).toBe('https://cee.buzz/api/android/banner/level/2');
  });

  it('ISP-005: switching clears cached API answers and notifies subscribers', async () => {
    const kv = stubStorage();
    const ok = (v: unknown) => (async () => new Response(JSON.stringify(v))) as unknown as typeof fetch;
    const old = `${apiBase('el')}banner/level/0`;
    await fetchJson(old, { fetchImpl: ok([{ nb: 1 }]), store: kv });
    expect(kv.getItem(CACHE_PREFIX + old)).not.toBeNull();
    kv.setItem('wmp:state:v1', '{}');
    switchIsp('other');
    expect(getIsp()).toBe('other');
    expect(kv.getItem(CACHE_PREFIX + old)).toBeNull();
    expect(kv.getItem('wmp:state:v1')).toBe('{}');
    const fetchImpl = vi.fn(ok([{ nb: 2 }]));
    expect(await fetchJson(old, { fetchImpl, store: kv })).toEqual([{ nb: 2 }]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('ISP-005: clearApiCache removes only API entries', () => {
    const kv = memoryStore();
    kv.setItem(`${CACHE_PREFIX}x`, '{}');
    kv.setItem('other', '1');
    clearApiCache(kv);
    expect(kv.getItem(`${CACHE_PREFIX}x`)).toBeNull();
    expect(kv.getItem('other')).toBe('1');
  });

  it('ISP-006: bare image paths use the current provider image host, and stored artwork links are re-pointed', () => {
    stubStorage();
    expect(url('vascin-poster-images/x.jpg')).toBe(`${imageBase('el')}vascin-poster-images/x.jpg`);
    setIsp('other');
    expect(url('vascin-poster-images/x.jpg')).toBe(`${imageBase('other')}vascin-poster-images/x.jpg`);
    const elImage = `${imageBase('el')}a.jpg?Signature=a%2Bb`;
    expect(rehostImage(elImage, 'other')).toBe(`${imageBase('other')}a.jpg?Signature=a%2Bb`);
    expect(rehostImage(`${imageBase('other')}a.jpg`, 'other')).toBe(`${imageBase('other')}a.jpg`);
    expect(rehostImage('https://image.tmdb.org/t/p/w780/a.jpg', 'other')).toBe('https://image.tmdb.org/t/p/w780/a.jpg');
    // Any catalog image host (other numbers or domains) maps to the active provider's image host.
    expect(rehostImage('https://cnth2.shabakaty.cc/p/a.jpg?x=1', 'other')).toBe(`${imageBase('other')}p/a.jpg?x=1`);
    expect(rehostImage('https://cnth3.cee.buzz/p/a.jpg', 'el')).toBe(`${imageBase('el')}p/a.jpg`);
    expect(rehostImage('https://cnth2.shabakaty.cc/p/a.jpg', 'el')).toBe(`${imageBase('el')}p/a.jpg`);
    expect(isCatalogImageHost('cnth9.shabakaty.com')).toBe(true);
    expect(isCatalogImageHost('evil.example.com')).toBe(false);
    expect(isCatalogImageHost('cnth2.evil.com')).toBe(false);
    expect(rehostImage('https://cnth2.evil.com/a.jpg', 'other')).toBe('https://cnth2.evil.com/a.jpg');
    expect(url('https://cdn.cee.buzz/v.mp4?x=1', '')).toBe('https://cdn.cee.buzz/v.mp4?x=1');
  });

  it('ISP-007: a catalog request that fails on the network is reported until a request succeeds', async () => {
    stubStorage();
    const base = `${apiBase()}banner/level/9`;
    const boom = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(fetchJson(base, { fetchImpl: boom, retries: 0, store: null, sleep: async () => {} })).rejects.toThrow();
    expect(catalogFailed()).toBe(true);
    await fetchJson(`${apiBase()}banner/level/8`, { fetchImpl: (async () => new Response('[]')) as unknown as typeof fetch, store: null });
    expect(catalogFailed()).toBe(false);
    expect(isNetworkError(new TypeError('x'))).toBe(true);
    expect(isNetworkError(new Error('HTTP 500'))).toBe(false);
  });
});
