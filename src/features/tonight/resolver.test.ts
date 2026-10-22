import { describe, expect, it } from 'vitest';
import type { TmdbCandidate } from '../../api/tmdb';
import type { Title } from '../../api/types';
import { genreAffinity } from '../../lib/recommend';
import { genre, title } from './fixtures';
import { discoverPath, filterTitles, rankTitles, reasonFor, relax, resolvePicks, type ResolveDeps } from './resolver';
import type { TonightFilters } from './types';

const f = (over: Partial<TonightFilters> = {}): TonightFilters => ({ type: 'any', genres: [], excludeGenres: [], keywords: [], ...over });
const affinity = genreAffinity({ onboardingGenres: ['Drama'], ratings: {}, watched: [] });

describe('resolver', () => {
  it('TONIGHT-009: builds a TMDB discover path the proxy accepts', () => {
    const p = discoverPath(f({ genres: ['comedy', 'family'], excludeGenres: ['horror'], maxMinutes: 100, minYear: 2010, maxYear: 2020, lang: 'ar' }), 'movie', 2);
    expect(p).toBe('/discover/movie?sort_by=popularity.desc&vote_count.gte=150&with_genres=35|10751&without_genres=27&with_runtime.lte=100&primary_release_date.gte=2010-01-01&primary_release_date.lte=2020-12-31&with_original_language=ar&page=2');
    expect(p).toMatch(/^\/[A-Za-z0-9/_\-.?=&,|]+$/);
    expect(discoverPath(f({ minYear: 2015 }), 'tv')).toContain('first_air_date.gte=2015-01-01');
  });

  it('TONIGHT-009: keeps only titles that satisfy the filters, the family level and not yet watched', () => {
    const titles: Title[] = [
      title({ id: 'ok', genres: [genre('Comedy')], duration: 90 * 60 }),
      title({ id: 'long', genres: [genre('Comedy')], duration: 150 * 60 }),
      title({ id: 'scary', genres: [genre('Horror')] }),
      title({ id: 'seen' }),
      title({ id: 'old', year: 1990 }),
      title({ id: 'show', kind: 'series', duration: 3000 * 60 }),
    ];
    const out = filterTitles(titles, f({ type: 'movie', excludeGenres: ['horror'], maxMinutes: 100, minYear: 2000 }), new Set(['seen']), 0).map((t) => t.id);
    expect(out).toEqual(['ok']);
    expect(filterTitles([titles[0]!, titles[0]!], f(), new Set(), 0)).toHaveLength(1);
    expect(filterTitles([title({ id: 'unrated' })], f(), new Set(), 3)).toEqual([]); // kids level: unrated titles stay out
    expect(filterTitles(titles, f({ type: 'tv' }), new Set(), 0).map((t) => t.id)).toEqual(['show']);
  });

  it('TONIGHT-010: ranks by the requested genres and taste, and explains each pick from what matched', () => {
    const drama = title({ id: 'd', genres: [genre('Drama')], stars: 6 });
    const comedy = title({ id: 'c', genres: [genre('Comedy')], stars: 6 });
    const other = title({ id: 'o', genres: [genre('Western')], stars: 9 });
    const filters = f({ genres: ['comedy'] });
    expect(rankTitles([other, drama, comedy], filters, affinity).map((t) => t.id)).toEqual(['c', 'd', 'o']);
    expect(rankTitles([other, drama, comedy], filters, affinity)[0]?.id).toBe('c');
    expect(reasonFor(comedy, filters, affinity, 'en')).toBe('Matches your mood: Comedy');
    expect(reasonFor(drama, filters, affinity, 'en')).toBe('You like Drama');
    expect(reasonFor(drama, filters, affinity, 'ar')).toContain('Drama');
    expect(reasonFor(other, f(), affinity, 'en')).toBe('Highly rated: 9.0');
    expect(reasonFor(title({ id: 'p', stars: 5 }), f(), affinity, 'en')).toBe('Popular right now');
  });

  it('TONIGHT-011: relaxes the filters step by step and returns real catalog titles with reasons', () => {
    expect(relax(f({ maxMinutes: 90, excludeGenres: ['horror'], genres: ['comedy'] }))).toEqual(f({ excludeGenres: ['horror'], genres: ['comedy'] }));
    expect(relax(f({ excludeGenres: ['horror'], genres: ['comedy'] }))).toEqual(f({ genres: ['comedy'] }));
    expect(relax(f({ genres: ['comedy'] }))).toEqual(f());
    expect(relax(f())).toBeNull();

    const seen: string[] = [];
    const deps: ResolveDeps = {
      level: 0, affinity, exclude: new Set(), lang: 'en',
      discover: async (path) => {
        seen.push(path);
        return path.includes('with_runtime') ? [] : ([{ tmdbId: 1, name: 'Funny', year: 2020 }] as TmdbCandidate[]);
      },
      match: async (c) => c.map((x) => title({ id: `t${x.tmdbId}`, enTitle: x.name, genres: [genre('Comedy')] })),
    };
    return resolvePicks(f({ type: 'movie', genres: ['comedy'], maxMinutes: 50 }), deps).then((picks) => {
      expect(picks.map((p) => p.title.id)).toEqual(['t1']);
      expect(picks[0]?.reason).toBe('Matches your mood: Comedy');
      expect(seen.some((p) => p.includes('with_runtime.lte=50'))).toBe(true);
      expect(seen.some((p) => !p.includes('with_runtime'))).toBe(true);
    });
  });

  it('TONIGHT-011: falls back to the catalog genre lists when TMDB is down, and returns nothing when nothing matches', async () => {
    const deps: ResolveDeps = {
      level: 0, affinity, exclude: new Set(), lang: 'en',
      discover: async () => { throw new Error('down'); },
      catalogGenre: async (kind) => [title({ id: `c-${kind}`, kind, genres: [genre('Comedy')] })],
    };
    const picks = await resolvePicks(f({ type: 'movie', genres: ['comedy'] }), deps);
    expect(picks.map((p) => p.title.id)).toEqual(['c-movie']);
    expect(await resolvePicks(f({ genres: ['comedy'] }), { ...deps, catalogGenre: async () => [] })).toEqual([]);
  });
});
