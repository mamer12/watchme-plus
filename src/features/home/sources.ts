/** Which titles feed the "Because You…" rows. Pure. */
import type { LibraryState, Snapshot } from '../../state/library';

export type BecauseReason = 'loved' | 'watched' | 'liked';
export interface BecauseSource {
  snap: Snapshot;
  reason: BecauseReason;
}

/**
 * Up to `count` distinct titles with an IMDb id: the ones rated "love" first, then the most recently watched, then the
 * ones liked (onboarding picks are likes). Disliked titles never seed a row.
 */
export function becauseSources(s: Pick<LibraryState, 'progress' | 'ratings' | 'snapshots'>, kind: 'movie' | 'series' | null, count = 3): BecauseSource[] {
  const out: BecauseSource[] = [];
  const seen = new Set<string>();
  const take = (id: string, reason: BecauseReason) => {
    const snap = s.snapshots[id];
    if (out.length >= count || seen.has(id) || !snap?.imdbId || s.ratings[id] === 'dislike') return;
    if (kind && snap.kind !== kind) return;
    seen.add(id);
    out.push({ snap, reason });
  };
  for (const [id, r] of Object.entries(s.ratings)) if (r === 'love') take(id, 'loved');
  const watched = Object.values(s.progress).map((p) => ({ id: p.seriesId ?? p.id, t: p.updatedAt }));
  for (const e of watched.sort((a, b) => b.t - a.t)) take(e.id, 'watched');
  for (const [id, r] of Object.entries(s.ratings)) if (r === 'like') take(id, 'liked');
  return out;
}

export const BECAUSE_LABEL: Record<BecauseReason, string> = {
  loved: 'Because You Loved',
  watched: 'Because You Watched',
  liked: 'Because You Liked',
};
