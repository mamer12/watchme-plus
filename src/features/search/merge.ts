import type { Title } from '../../api/types';
import { normalizeName } from '../../api/match';

/**
 * Movies and series answers merged into one list: titles that start with the query first,
 * then the rest, alternating kinds, without duplicates.
 */
export function mergeResults(query: string, movies: Title[], series: Title[]): Title[] {
  const q = normalizeName(query);
  const seen = new Set<string>();
  const merged: Title[] = [];
  const max = Math.max(movies.length, series.length);
  for (let i = 0; i < max; i++) {
    for (const t of [movies[i], series[i]]) {
      if (t && !seen.has(t.id)) {
        seen.add(t.id);
        merged.push(t);
      }
    }
  }
  const starts = (t: Title) => normalizeName(t.enTitle).startsWith(q) || normalizeName(t.arTitle).startsWith(q);
  return [...merged.filter(starts), ...merged.filter((t) => !starts(t))];
}
