/** The single user's library: settings, My List, ratings and watch progress. Pure state operations. */
import type { Kind, Level, Title, TitleLang } from '../api/types';
import type { Rating } from '../lib/recommend';

export type SubtitleLang = 'ar' | 'en' | 'off';
export type SubtitleSize = 'small' | 'medium' | 'large';
export type SubtitleColor = 'white' | 'yellow' | 'cyan';
export type SubtitleBackground = 'none' | 'shadow' | 'box';
export type KindChoice = Kind | 'both';

export interface Settings {
  level: Level;
  subtitleLang: SubtitleLang;
  subtitleSize: SubtitleSize;
  subtitleColor: SubtitleColor;
  subtitleBackground: SubtitleBackground;
  /** seconds, applied to every cue */
  subtitleOffset: number;
  previewAutoplay: boolean;
  autoplayNext: boolean;
  familySkips: boolean;
  titleLang: TitleLang;
  /** The fixed quality picked in the player (used while qualityAuto is off). */
  quality: string;
  /** Quality follows the connection by itself (picking a fixed one in the player turns it off). */
  qualityAuto: boolean;
  /** Highest quality auto may pick. */
  qualityCap: string;
  volume: number;
  muted: boolean;
}

export type Snapshot = Pick<
  Title,
  | 'id'
  | 'kind'
  | 'enTitle'
  | 'arTitle'
  | 'enContent'
  | 'arContent'
  | 'poster'
  | 'posterThumb'
  | 'cover'
  | 'year'
  | 'imdbId'
  | 'genres'
  | 'stars'
  | 'filmRating'
  | 'seriesRating'
  | 'duration'
  | 'season'
  | 'episode'
  | 'trailer'
>;

export interface ProgressEntry {
  id: string;
  seriesId: string | null;
  season: number | null;
  episode: number | null;
  position: number;
  duration: number;
  completed: boolean;
  updatedAt: number;
  /** Name of the device the position came from, when it was synced from another one. */
  from?: string;
}

export interface SeriesPointer {
  episodeId: string;
  updatedAt: number;
  /** The previous episode was finished and this one is next (position 0). */
  upNext: boolean;
}

export interface LibraryState {
  version: 1;
  onboarding: { done: boolean; kinds: KindChoice; genres: string[] };
  settings: Settings;
  myList: string[];
  ratings: Record<string, Rating>;
  progress: Record<string, ProgressEntry>;
  seriesLast: Record<string, SeriesPointer>;
  snapshots: Record<string, Snapshot>;
}

export const DEFAULT_SETTINGS: Settings = {
  level: 0,
  subtitleLang: 'ar',
  subtitleSize: 'medium',
  subtitleColor: 'white',
  subtitleBackground: 'shadow',
  subtitleOffset: 0,
  previewAutoplay: true,
  autoplayNext: true,
  familySkips: false,
  titleLang: 'en',
  quality: '1080p',
  qualityAuto: true,
  qualityCap: '1080p',
  volume: 1,
  muted: false,
};

/** Choices that depend on the device (screen, decoder, connection, speakers): shared by every profile, never synced. */
export const DEVICE_SETTING_KEYS = ['quality', 'qualityAuto', 'qualityCap', 'previewAutoplay', 'volume', 'muted'] as const satisfies readonly (keyof Settings)[];
export type DeviceSettings = Pick<Settings, (typeof DEVICE_SETTING_KEYS)[number]>;

export function pickDevice(s: Settings): DeviceSettings {
  return { quality: s.quality, qualityAuto: s.qualityAuto, qualityCap: s.qualityCap, previewAutoplay: s.previewAutoplay, volume: s.volume, muted: s.muted };
}

export function initialState(): LibraryState {
  return {
    version: 1,
    onboarding: { done: false, kinds: 'both', genres: [] },
    settings: { ...DEFAULT_SETTINGS },
    myList: [],
    ratings: {},
    progress: {},
    seriesLast: {},
    snapshots: {},
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Restores saved state, dropping anything malformed and filling new settings with defaults. */
export function hydrate(saved: unknown): LibraryState {
  const base = initialState();
  if (!isRecord(saved) || saved.version !== 1) return base;
  const s = saved as Partial<LibraryState>;
  const settings = isRecord(s.settings) ? { ...DEFAULT_SETTINGS, ...(s.settings as Partial<Settings>) } : base.settings;
  if (![0, 2, 3].includes(settings.level)) settings.level = 0;
  return {
    version: 1,
    onboarding: isRecord(s.onboarding) ? { ...base.onboarding, ...s.onboarding } : base.onboarding,
    settings,
    myList: Array.isArray(s.myList) ? s.myList.filter((x): x is string => typeof x === 'string') : [],
    ratings: isRecord(s.ratings) ? (s.ratings as Record<string, Rating>) : {},
    progress: isRecord(s.progress) ? (s.progress as Record<string, ProgressEntry>) : {},
    seriesLast: isRecord(s.seriesLast) ? (s.seriesLast as Record<string, SeriesPointer>) : {},
    snapshots: isRecord(s.snapshots) ? (s.snapshots as Record<string, Snapshot>) : {},
  };
}

export function snapshot(t: Title): Snapshot {
  return {
    id: t.id,
    kind: t.kind,
    enTitle: t.enTitle,
    arTitle: t.arTitle,
    enContent: t.enContent.slice(0, 400),
    arContent: t.arContent.slice(0, 400),
    poster: t.poster,
    posterThumb: t.posterThumb,
    cover: t.cover,
    year: t.year,
    imdbId: t.imdbId,
    genres: t.genres,
    stars: t.stars,
    filmRating: t.filmRating,
    seriesRating: t.seriesRating,
    duration: t.duration,
    season: t.season,
    episode: t.episode,
    trailer: t.trailer,
  };
}

/** Snapshots back to full titles for rows. */
export function fromSnapshot(s: Snapshot): Title {
  return { ...s, season: s.season ?? null, episode: s.episode ?? null, trailer: s.trailer ?? null };
}

const withSnapshot = (s: LibraryState, t: Title): Record<string, Snapshot> => ({ ...s.snapshots, [t.id]: snapshot(t) });

export function toggleMyList(s: LibraryState, t: Title): LibraryState {
  const has = s.myList.includes(t.id);
  return {
    ...s,
    myList: has ? s.myList.filter((id) => id !== t.id) : [t.id, ...s.myList],
    snapshots: withSnapshot(s, t),
  };
}

export function setRating(s: LibraryState, t: Title, rating: Rating | null): LibraryState {
  const ratings = { ...s.ratings };
  if (rating === null || ratings[t.id] === rating) delete ratings[t.id];
  else ratings[t.id] = rating;
  return { ...s, ratings, snapshots: withSnapshot(s, t) };
}

export const COMPLETE_FRACTION = 0.94;
const MIN_POSITION = 5;

export interface ProgressUpdate {
  video: Title;
  /** The series' key (first episode id) and its snapshot, for episodes. */
  series: Title | null;
  position: number;
  duration: number;
  /** The episode after this one, if any. */
  next: Title | null;
  now?: number;
}

export function isComplete(position: number, duration: number): boolean {
  return duration > 0 && (position / duration >= COMPLETE_FRACTION || duration - position < 20);
}

export function recordProgress(s: LibraryState, u: ProgressUpdate): LibraryState {
  const { video, series, position, duration } = u;
  if (!(duration > 0) || !Number.isFinite(position) || position < MIN_POSITION) return s;
  const now = u.now ?? Date.now();
  const completed = isComplete(position, duration);
  const entry: ProgressEntry = {
    id: video.id,
    seriesId: series ? series.id : null,
    season: video.season,
    episode: video.episode,
    position: completed ? 0 : position,
    duration,
    completed,
    updatedAt: now,
  };
  let snapshots = withSnapshot(s, video);
  let seriesLast = s.seriesLast;
  if (series) {
    snapshots = { ...snapshots, [series.id]: snapshot(series) };
    const pointer: SeriesPointer =
      completed && u.next
        ? { episodeId: u.next.id, updatedAt: now, upNext: true }
        : { episodeId: video.id, updatedAt: now, upNext: false };
    if (completed && u.next) snapshots = { ...snapshots, [u.next.id]: snapshot(u.next) };
    seriesLast = { ...s.seriesLast, [series.id]: pointer };
    // Finished the final episode: drop out of Continue Watching.
    if (completed && !u.next) {
      seriesLast = { ...s.seriesLast };
      delete seriesLast[series.id];
    }
  }
  return { ...s, progress: { ...s.progress, [video.id]: entry }, seriesLast, snapshots };
}

export interface ContinueItem {
  title: Title;
  /** The video to play (movie id or episode id). */
  videoId: string;
  season: number | null;
  episode: number | null;
  fraction: number;
  updatedAt: number;
  /** The other device this position came from (synced), if any. */
  from?: string;
}

export function continueWatching(s: Pick<LibraryState, 'progress' | 'seriesLast' | 'snapshots'>, kind?: Kind): ContinueItem[] {
  const items: ContinueItem[] = [];
  for (const p of Object.values(s.progress)) {
    if (p.seriesId || p.completed) continue;
    const snap = s.snapshots[p.id];
    if (!snap) continue;
    items.push({
      title: fromSnapshot(snap),
      videoId: p.id,
      season: null,
      episode: null,
      fraction: p.duration > 0 ? p.position / p.duration : 0,
      updatedAt: p.updatedAt,
      from: p.from,
    });
  }
  for (const [seriesId, ptr] of Object.entries(s.seriesLast)) {
    const snap = s.snapshots[seriesId];
    if (!snap) continue;
    const p = s.progress[ptr.episodeId];
    const ep = s.snapshots[ptr.episodeId];
    items.push({
      title: fromSnapshot(snap),
      videoId: ptr.episodeId,
      season: ep?.season ?? p?.season ?? null,
      episode: ep?.episode ?? p?.episode ?? null,
      fraction: ptr.upNext || !p || p.duration <= 0 ? 0 : p.position / p.duration,
      updatedAt: ptr.updatedAt,
      from: p?.from,
    });
  }
  return items.filter((i) => !kind || i.title.kind === kind).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function removeFromContinue(s: LibraryState, titleId: string): LibraryState {
  const progress = { ...s.progress };
  const seriesLast = { ...s.seriesLast };
  if (seriesLast[titleId]) delete seriesLast[titleId];
  const p = progress[titleId];
  if (p && !p.seriesId) progress[titleId] = { ...p, completed: true, position: 0 };
  return { ...s, progress, seriesLast };
}

export interface Resume {
  videoId: string;
  position: number;
  season: number | null;
  episode: number | null;
  /** seconds left in the video, when known */
  remaining: number | null;
  started: boolean;
}

/** Where Play should start for a title: the series' current episode or the movie's saved position. */
export function resumeFor(s: LibraryState, title: Pick<Title, 'id' | 'kind'>, seriesKey?: string): Resume | null {
  if (title.kind === 'series') {
    const ptr = s.seriesLast[seriesKey ?? title.id];
    if (!ptr) return null;
    const p = s.progress[ptr.episodeId];
    const position = ptr.upNext || !p || p.completed ? 0 : p.position;
    return {
      videoId: ptr.episodeId,
      position,
      season: p?.season ?? s.snapshots[ptr.episodeId]?.season ?? null,
      episode: p?.episode ?? s.snapshots[ptr.episodeId]?.episode ?? null,
      remaining: p && !ptr.upNext && p.duration > 0 ? Math.max(0, p.duration - position) : null,
      started: true,
    };
  }
  const p = s.progress[title.id];
  if (!p || p.completed) return null;
  return { videoId: title.id, position: p.position, season: null, episode: null, remaining: Math.max(0, p.duration - p.position), started: true };
}

/** Start position when opening a video in the player. */
export function startPosition(s: LibraryState, videoId: string): number {
  const p = s.progress[videoId];
  if (!p || p.completed) return 0;
  return isComplete(p.position, p.duration) ? 0 : p.position;
}

export function clearHistory(s: LibraryState): LibraryState {
  return { ...s, progress: {}, seriesLast: {} };
}

/** Titles the user has finished or disliked, excluded from recommendations. */
export function excludedIds(s: Pick<LibraryState, 'ratings' | 'progress'>): Set<string> {
  const out = new Set<string>();
  for (const [id, r] of Object.entries(s.ratings)) if (r === 'dislike') out.add(id);
  for (const p of Object.values(s.progress)) if (p.completed && !p.seriesId) out.add(p.id);
  return out;
}

export function updateSettings(s: LibraryState, patch: Partial<Settings>): LibraryState {
  return { ...s, settings: { ...s.settings, ...patch } };
}

export function completeOnboarding(s: LibraryState, kinds: KindChoice, genres: string[], liked: Title[]): LibraryState {
  let next: LibraryState = { ...s, onboarding: { done: true, kinds, genres } };
  for (const t of liked) next = setRating(next, t, 'like');
  return next;
}
