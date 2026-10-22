/** A compact, anonymous summary of the active profile's taste, sent to the AI as data. Pure. */
import type { LibraryState } from '../../state/library';
import { genreAffinity } from '../../lib/recommend';
import type { Lang } from './types';

export const MAX_SUMMARY_BYTES = 1500;
const TOP_GENRES = 6;
const MAX_RECENT = 10;
const MAX_LIKED = 10;
const MAX_DISLIKED = 5;
const NAME_MAX = 40;
/** Thursday evening starts the Iraqi weekend (Friday and Saturday are off). */
const WEEKEND_EVE_DAY = 4;
const WEEKEND_EVE_HOUR = 16;

export interface TasteSummary {
  genres: { g: string; w: number }[];
  lang: Lang;
  eras: Record<string, number>;
  recent: string[];
  liked: string[];
  disliked: string[];
  ctx: { weekday: string; hour: number; isWeekendEve: boolean };
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export const isWeekendEve = (now: Date): boolean => now.getDay() === WEEKEND_EVE_DAY && now.getHours() >= WEEKEND_EVE_HOUR;

export function timeContext(now: Date): TasteSummary['ctx'] {
  return { weekday: WEEKDAYS[now.getDay()] ?? 'monday', hour: now.getHours(), isWeekendEve: isWeekendEve(now) };
}

export function buildTasteSummary(s: LibraryState, now: Date, lang: Lang = 'en'): TasteSummary {
  const nameOf = (id: string): string | null => {
    const t = s.snapshots[id];
    if (!t) return null;
    const name = (t.enTitle || t.arTitle || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
    return name || null;
  };
  const genresOf = (id: string): string[] => s.snapshots[id]?.genres.map((g) => g.en) ?? [];

  const affinity = genreAffinity({
    onboardingGenres: s.onboarding.genres,
    ratings: Object.fromEntries(Object.entries(s.ratings).map(([id, rating]) => [id, { rating, genres: genresOf(id) }])),
    watched: Object.values(s.progress).map((p) => ({
      genres: genresOf(p.seriesId ?? p.id),
      fraction: p.completed ? 1 : p.duration > 0 ? p.position / p.duration : 0,
    })),
  });
  const genres = [...affinity.entries()]
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_GENRES)
    .map(([g, w]) => ({ g, w: Math.round(w * 10) / 10 }));

  // Recent: latest activity per title (episodes count for their series).
  const latest = new Map<string, number>();
  const seenIds = new Set<string>();
  for (const p of Object.values(s.progress)) {
    const id = p.seriesId ?? p.id;
    seenIds.add(id);
    latest.set(id, Math.max(latest.get(id) ?? 0, p.updatedAt));
  }
  const unique = (names: (string | null)[], max: number): string[] => [...new Set(names.filter((n): n is string => !!n))].slice(0, max);
  const recent = unique([...latest.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => nameOf(id)), MAX_RECENT);

  const rated = (wanted: string[]) => Object.entries(s.ratings).filter(([, r]) => wanted.includes(r)).map(([id]) => id);
  const loved = rated(['love']);
  const liked = unique([...loved, ...rated(['like']), ...[...s.myList].reverse()].map(nameOf), MAX_LIKED);
  const disliked = unique(rated(['dislike']).map(nameOf), MAX_DISLIKED);

  const eras: Record<string, number> = {};
  for (const id of seenIds) {
    const y = s.snapshots[id]?.year;
    if (y) eras[`${Math.floor(y / 10) * 10}s`] = (eras[`${Math.floor(y / 10) * 10}s`] ?? 0) + 1;
  }
  const topEras = Object.fromEntries(Object.entries(eras).sort((a, b) => b[1] - a[1]).slice(0, 3));

  return capSummary({ genres, lang, eras: topEras, recent, liked, disliked, ctx: timeContext(now) });
}

/** Drops the least useful items until the JSON fits MAX_SUMMARY_BYTES. */
export function capSummary(sum: TasteSummary): TasteSummary {
  let out = { ...sum, genres: [...sum.genres], recent: [...sum.recent], liked: [...sum.liked], disliked: [...sum.disliked] };
  const size = (x: TasteSummary) => JSON.stringify(x).length;
  while (size(out) > MAX_SUMMARY_BYTES) {
    const longest = [out.recent, out.liked, out.disliked, out.genres].sort((a, b) => b.length - a.length)[0];
    if (!longest || longest.length === 0) {
      out = { ...out, eras: {} };
      break;
    }
    longest.pop();
  }
  return out;
}
