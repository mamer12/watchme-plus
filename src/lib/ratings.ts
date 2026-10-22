/** Age ratings and the family filter. */
import type { Level, Title } from '../api/types';

const FILM = ['', 'G', 'PG', 'PG-13', 'R', 'NC-17'] as const;
const SERIES = ['', 'TV-Y', 'TV-Y7', 'TV-G', 'TV-PG', 'TV-14', 'TV-MA'] as const;

/** Highest rating allowed per level (movies, series). Level 0 = everything. */
const LIMITS: Record<Level, { film: number; series: number }> = {
  0: { film: 99, series: 99 },
  2: { film: 3, series: 5 }, // up to PG-13 / TV-14
  3: { film: 2, series: 4 }, // kids: up to PG / TV-PG
};

function code(t: Pick<Title, 'kind' | 'filmRating' | 'seriesRating'>): number | null {
  const n = t.kind === 'series' ? t.seriesRating : t.filmRating;
  const max = t.kind === 'series' ? SERIES.length - 1 : FILM.length - 1;
  return n !== null && n >= 1 && n <= max ? n : null;
}

export function ageLabel(t: Pick<Title, 'kind' | 'filmRating' | 'seriesRating'>): string | null {
  const c = code(t);
  if (c === null) return null;
  return (t.kind === 'series' ? SERIES[c] : FILM[c]) ?? null;
}

/**
 * Client-side guard on top of the API's own `level` filter (used for deep links and TMDB matches).
 * Unknown ratings pass the family level but not the kids level.
 */
export function allowedAtLevel(t: Pick<Title, 'kind' | 'filmRating' | 'seriesRating'>, level: Level): boolean {
  if (level === 0) return true;
  const c = code(t);
  if (c === null) return level !== 3;
  const limit = LIMITS[level];
  return c <= (t.kind === 'series' ? limit.series : limit.film);
}

export const LEVEL_LABELS: Record<Level, string> = {
  0: 'All titles',
  2: 'Family (up to PG-13 / TV-14)',
  3: 'Kids (up to PG / TV-PG)',
};
