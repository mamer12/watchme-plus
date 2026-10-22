/** Genre affinity and Top Picks. Pure. */
import type { Title } from '../api/types';

export type Rating = 'dislike' | 'like' | 'love';

export interface TasteInput {
  /** Genres picked during onboarding. */
  onboardingGenres: string[];
  ratings: Record<string, { rating: Rating; genres: string[] }>;
  /** Titles watched (any progress), with how far along (0..1). */
  watched: { genres: string[]; fraction: number }[];
}

export type Affinity = Map<string, number>;

const WEIGHTS: Record<Rating, number> = { love: 3, like: 2, dislike: -3 };

const key = (g: string) => g.trim().toLowerCase();

export function genreAffinity(input: TasteInput): Affinity {
  const a: Affinity = new Map();
  const add = (g: string, w: number) => {
    const k = key(g);
    if (k) a.set(k, (a.get(k) ?? 0) + w);
  };
  for (const g of input.onboardingGenres) add(g, 2);
  for (const r of Object.values(input.ratings)) for (const g of r.genres) add(g, WEIGHTS[r.rating]);
  for (const w of input.watched) for (const g of w.genres) add(g, 0.5 + Math.min(1, Math.max(0, w.fraction)));
  return a;
}

/** Genres ordered by affinity (positive only). */
export function topGenres(a: Affinity, n = 6): string[] {
  return [...a.entries()]
    .filter(([, v]) => v > 0)
    .sort((x, y) => y[1] - x[1])
    .slice(0, n)
    .map(([k]) => k);
}

export function scoreTitle(t: Title, a: Affinity, boost = 0): number {
  let s = boost;
  for (const g of t.genres) s += a.get(key(g.en)) ?? 0;
  return s + (t.stars ?? 6) * 0.3 + (t.year && t.year >= new Date().getFullYear() - 2 ? 0.5 : 0);
}

/**
 * Candidates ranked by taste, excluding disliked, already-finished and duplicate titles; `boosts` adds to a title's
 * score (TMDB's recommendations for titles the user loved or liked).
 */
export function topPicks(candidates: Title[], a: Affinity, exclude: Set<string>, limit = 24, boosts?: Map<string, number>): Title[] {
  const seen = new Set<string>();
  return candidates
    .filter((t) => {
      if (exclude.has(t.id) || seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    })
    .map((t) => ({ t, s: scoreTitle(t, a, boosts?.get(t.id) ?? 0) }))
    .sort((x, y) => y.s - x.s)
    .slice(0, limit)
    .map((x) => x.t);
}
