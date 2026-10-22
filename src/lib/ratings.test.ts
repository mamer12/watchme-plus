import { describe, expect, it } from 'vitest';
import { ageLabel, allowedAtLevel } from './ratings';

const movie = (filmRating: number | null) => ({ kind: 'movie' as const, filmRating, seriesRating: null });
const show = (seriesRating: number | null) => ({ kind: 'series' as const, filmRating: null, seriesRating });

describe('ratings', () => {
  it('API-011: guards titles by family level on the client too', () => {
    expect(allowedAtLevel(movie(4), 0)).toBe(true);
    expect(allowedAtLevel(movie(3), 2)).toBe(true);
    expect(allowedAtLevel(movie(4), 2)).toBe(false);
    expect(allowedAtLevel(show(5), 2)).toBe(true);
    expect(allowedAtLevel(show(6), 2)).toBe(false);
    expect(allowedAtLevel(movie(2), 3)).toBe(true);
    expect(allowedAtLevel(movie(3), 3)).toBe(false);
    expect(allowedAtLevel(show(4), 3)).toBe(true);
    expect(allowedAtLevel(movie(null), 2)).toBe(true);
    expect(allowedAtLevel(movie(null), 3)).toBe(false);
  });

  it('API-012: labels film and TV ratings by kind', () => {
    expect(ageLabel(movie(3))).toBe('PG-13');
    expect(ageLabel(movie(5))).toBe('NC-17');
    expect(ageLabel(show(6))).toBe('TV-MA');
    expect(ageLabel(show(1))).toBe('TV-Y');
    expect(ageLabel(movie(9))).toBeNull();
    expect(ageLabel(movie(null))).toBeNull();
  });
});
