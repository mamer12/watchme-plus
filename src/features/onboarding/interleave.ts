import type { Title } from '../../api/types';

/** Alternates two lists (movies, series), skipping duplicates, up to `limit`. */
export function interleave(a: Title[], b: Title[], limit: number): Title[] {
  const out: Title[] = [];
  const seen = new Set<string>();
  for (let i = 0; out.length < limit && (i < a.length || i < b.length); i++) {
    for (const t of [a[i], b[i]]) {
      if (t && !seen.has(t.id) && out.length < limit) {
        seen.add(t.id);
        out.push(t);
      }
    }
  }
  return out;
}
