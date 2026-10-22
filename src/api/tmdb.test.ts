import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryStore } from '../lib/storage';
import { clearMemoryCache } from './http';

const backdrops = [
  { file_path: '/text.jpg', iso_639_1: 'en', width: 3840, vote_average: 9 },
  { file_path: '/small.jpg', iso_639_1: null, width: 1280, vote_average: 9 },
  { file_path: '/big.jpg', iso_639_1: null, width: 1920, vote_average: 5 },
];
const logos = [
  { file_path: '/en.svg', iso_639_1: 'en', width: 800, vote_average: 9 },
  { file_path: '/en.png', iso_639_1: 'en', width: 500, vote_average: 5 },
  { file_path: '/ar.png', iso_639_1: 'ar', width: 500, vote_average: 5 },
];

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe('tmdb client', () => {
  beforeEach(() => {
    vi.resetModules();
    clearMemoryCache();
    vi.stubGlobal('localStorage', memoryStore());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('TMDB-005: picks the largest textless backdrop and a PNG logo per language', async () => {
    const { pickBackdrop, pickLogo } = await import('./tmdb');
    expect(pickBackdrop(backdrops)).toBe('https://image.tmdb.org/t/p/w780/big.jpg');
    expect(pickBackdrop([{ file_path: '/only.jpg', iso_639_1: 'fr', width: 1 }])).toBe('https://image.tmdb.org/t/p/w780/only.jpg');
    expect(pickBackdrop(null)).toBeNull();
    expect(pickLogo(logos, 'en')).toBe('https://image.tmdb.org/t/p/w500/en.png');
    expect(pickLogo(logos, 'ar')).toBe('https://image.tmdb.org/t/p/w500/ar.png');
    expect(pickLogo(logos, 'fr')).toBeNull();
  });

  it('TMDB-006: reads /find answers for movies, shows and episodes', async () => {
    const { parseFind } = await import('./tmdb');
    expect(parseFind({ movie_results: [{ id: 550 }], tv_results: [] }, 'movie')).toEqual({ id: 550, media: 'movie' });
    expect(parseFind({ movie_results: [], tv_results: [{ id: 1396 }] }, 'series')).toEqual({ id: 1396, media: 'tv' });
    expect(parseFind({ tv_episode_results: [{ id: 1, show_id: 1399 }] }, 'series')).toEqual({ id: 1399, media: 'tv' });
    expect(parseFind({ movie_results: null }, 'movie')).toBeNull();
    expect(parseFind('<html>', 'movie')).toBeNull();
  });

  it('TMDB-008: stops calling the proxy after repeated failures so the app degrades quietly', async () => {
    const fetchMock = vi.fn(async () => new Response('{"error":"x"}', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const mod = await import('./tmdb');
    for (let i = 0; i < 4; i++) await expect(mod.getTrending('movie')).rejects.toThrow();
    expect(mod.tmdbAvailable()).toBe(false);
    const calls = fetchMock.mock.calls.length;
    await expect(mod.getTrending('movie')).rejects.toThrow();
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('TMDB-009: caches box art in localStorage, including misses', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = decodeURIComponent(String(input));
      if (u.includes('/find/tt1')) return json({ movie_results: [{ id: 7 }] });
      if (u.includes('/movie/7/images')) return json({ backdrops, logos });
      if (u.includes('/find/tt2')) return json({ movie_results: [], tv_results: [] });
      return new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { getArt, peekArt } = await import('./tmdb');
    const art = await getArt('tt1', 'movie');
    expect(art).toMatchObject({ tmdbId: 7, media: 'movie', backdrop: 'https://image.tmdb.org/t/p/w780/big.jpg', logoEn: 'https://image.tmdb.org/t/p/w500/en.png' });
    expect(peekArt('tt1')).toEqual(art);
    expect(await getArt('tt2', 'movie')).toBeNull();
    expect(peekArt('tt2')).toBeNull();
    expect(peekArt('tt3')).toBeUndefined();
    const calls = fetchMock.mock.calls.length;
    await getArt('tt1', 'movie');
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('TMDB-010: asks /discover for all-time popular titles in the picked genres (OR), sorted by votes', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const u = decodeURIComponent(String(input));
        urls.push(u);
        const page = u.endsWith('page=1') ? 1 : 2;
        return json({
          results:
            page === 1
              ? [{ id: 1, title: 'Inception', release_date: '2010-07-15', vote_count: 30000 }]
              : [{ id: 2, title: 'Interstellar', release_date: '2014-11-05', vote_count: 32000 }, { id: 1, title: 'Inception', vote_count: 30000 }],
        });
      }),
    );
    const { getPopularAllTime, tmdbGenreIds } = await import('./tmdb');
    expect(tmdbGenreIds(['Action', 'Sci-Fi', 'Sport'], 'movie')).toEqual([28, 878]);
    expect(tmdbGenreIds(['Action', 'Adventure', 'Fantasy'], 'series')).toEqual([10759, 10765]);
    const list = await getPopularAllTime('movie', ['Action', 'Sci-Fi']);
    expect(urls.some((u) => u.includes('/discover/movie?sort_by=vote_count.desc&with_genres=28|878&page=1'))).toBe(true);
    expect(urls.some((u) => u.includes('page=2'))).toBe(true);
    expect(list.map((c) => c.name)).toEqual(['Interstellar', 'Inception']);
  });

  it('HOME-004: builds a Top 10 by matching TMDB trending titles to the catalog', async () => {
    const trending = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, title: `Film ${i + 1}`, release_date: '2025-01-01' }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const u = decodeURIComponent(String(input));
        if (u.includes('/trending/movie/week')) return json({ results: trending });
        const m = /videoTitle=([^&]+)/.exec(u);
        if (m) {
          const name = decodeURIComponent(m[1] ?? '');
          if (name === 'Film 3') return json([]); // not on the catalog
          return json([{ nb: String(100 + Number(name.split(' ')[1])), en_title: name, year: '2025', kind: '1' }]);
        }
        return new Response('', { status: 404 });
      }),
    );
    const { getTrending, matchToCatalog } = await import('./tmdb');
    const top = await matchToCatalog(await getTrending('movie'), 'movie', 0, 10);
    expect(top).toHaveLength(10);
    expect(top[0]?.id).toBe('101');
    expect(top.map((t) => t.id)).not.toContain('103');
  });
});
