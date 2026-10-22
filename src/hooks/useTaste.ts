import { useMemo } from 'react';
import { genreAffinity, type Affinity } from '../lib/recommend';
import { useLibrary } from '../state/store';

/** The user's genre affinity, from onboarding, ratings and watch history. */
export function useTaste(): Affinity {
  const onboarding = useLibrary((s) => s.onboarding);
  const ratings = useLibrary((s) => s.ratings);
  const progress = useLibrary((s) => s.progress);
  const snapshots = useLibrary((s) => s.snapshots);
  return useMemo(() => {
    const genresOf = (id: string) => snapshots[id]?.genres.map((g) => g.en) ?? [];
    return genreAffinity({
      onboardingGenres: onboarding.genres,
      ratings: Object.fromEntries(Object.entries(ratings).map(([id, rating]) => [id, { rating, genres: genresOf(id) }])),
      watched: Object.values(progress).map((p) => ({
        genres: genresOf(p.seriesId ?? p.id),
        fraction: p.completed ? 1 : p.duration > 0 ? p.position / p.duration : 0,
      })),
    });
  }, [onboarding, ratings, progress, snapshots]);
}
