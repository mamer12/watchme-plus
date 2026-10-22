import { describe, expect, it } from 'vitest';
import { parseTitle } from '../api/parse';
import type { Title } from '../api/types';
import { genreAffinity, topGenres, topPicks } from './recommend';

const t = (nb: string, genres: string[], stars = '7'): Title =>
  parseTitle({ nb, en_title: `T${nb}`, stars, categories: genres.map((g) => ({ en_title: g })) })!;

const taste = genreAffinity({
  onboardingGenres: ['Action', 'Sci-Fi'],
  ratings: { a: { rating: 'love', genres: ['Sci-Fi'] }, b: { rating: 'dislike', genres: ['Horror'] } },
  watched: [{ genres: ['Action'], fraction: 1 }],
});

describe('recommendations', () => {
  it('HOME-005: weighs onboarding genres, ratings and watch history', () => {
    expect(taste.get('sci-fi')).toBe(5);
    expect(taste.get('action')).toBe(3.5);
    expect(taste.get('horror')).toBe(-3);
    expect(topGenres(taste)).toEqual(['sci-fi', 'action']);
  });

  it('HOME-005: ranks Top Picks by taste and leaves out excluded titles', () => {
    const picks = topPicks([t('1', ['Horror']), t('2', ['Sci-Fi']), t('3', ['Action']), t('2', ['Sci-Fi']), t('4', ['Sci-Fi'])], taste, new Set(['4']));
    expect(picks.map((p) => p.id)).toEqual(['2', '3', '1']);
  });

  it('HOME-005: titles similar to loved ones rank above those similar to liked ones', () => {
    const pool = [t('1', ['Drama']), t('2', ['Drama']), t('3', ['Drama'])];
    const boosts = new Map([['2', 4], ['3', 2.5]]);
    expect(topPicks(pool, new Map(), new Set(), 10, boosts).map((p) => p.id)).toEqual(['2', '3', '1']);
  });
});
