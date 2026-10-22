import type { Kind, Title } from '../../api/types';
import { genreId, KNOWN_GENRES } from '../../api/catalog';

/** "More Like This" asks the catalog for the same kind in the title's first known genre. */
export function moreLikeThisQuery(t: Pick<Title, 'kind' | 'genres'>): { kind: Kind; genreId: number } {
  for (const g of t.genres) {
    const id = genreId(g.en);
    if (id !== null) return { kind: t.kind, genreId: id };
  }
  return { kind: t.kind, genreId: KNOWN_GENRES[6]?.id ?? 62 }; // Drama
}
