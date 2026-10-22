import type { Title } from '../../api/types';
import { initialState, snapshot, type LibraryState } from '../../state/library';

export function title(over: Partial<Title> & { id: string }): Title {
  return {
    kind: 'movie', enTitle: over.id, arTitle: '', enContent: '', arContent: '', year: 2020, stars: 6, season: null, episode: null,
    duration: 6000, poster: null, posterThumb: null, cover: null, imdbId: null, genres: [], filmRating: null, seriesRating: null, trailer: null,
    ...over,
  };
}

export const genre = (en: string) => ({ en, ar: en });

/** A library with a few watched, rated and listed titles. */
export function library(): LibraryState {
  const base = initialState();
  const a = title({ id: 'a', enTitle: 'Alpha', genres: [genre('Comedy')], year: 2021 });
  const b = title({ id: 'b', enTitle: 'Bravo', genres: [genre('Drama'), genre('Crime')], year: 2012 });
  const c = title({ id: 'c', enTitle: 'Charlie', genres: [genre('Horror')], year: 2019 });
  const d = title({ id: 'd', enTitle: 'Delta Show', kind: 'series', genres: [genre('Comedy')], year: 2022 });
  return {
    ...base,
    onboarding: { done: true, kinds: 'both', genres: ['Comedy'] },
    myList: ['d'],
    ratings: { a: 'love', b: 'like', c: 'dislike' },
    progress: {
      a: { id: 'a', seriesId: null, season: null, episode: null, position: 100, duration: 100, completed: true, updatedAt: 3000 },
      'd-e1': { id: 'd-e1', seriesId: 'd', season: 1, episode: 1, position: 50, duration: 100, completed: false, updatedAt: 5000 },
    },
    snapshots: { a: snapshot(a), b: snapshot(b), c: snapshot(c), d: snapshot(d) },
  };
}
