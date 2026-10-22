/** Catalog endpoints, called straight from the browser (CORS is open on the API and CDNs). */
import { apiBase } from './endpoints';
import { fetchJson } from './http';
import {
  parseCategories,
  parseDetails,
  parseEpisodes,
  parseGroups,
  parseSubtitles,
  parseTitleList,
  parseVideoFiles,
} from './parse';
import type { Category, Group, Kind, Level, SubtitleFiles, Title, TitleDetails, VideoFile } from './types';

/** Main categories as of 2026; the live list (`mainCategories`) is used when it loads. */
export const KNOWN_GENRES: Category[] = [
  { id: 84, title: 'Action' },
  { id: 56, title: 'Adventure' },
  { id: 57, title: 'Animation' },
  { id: 59, title: 'Comedy' },
  { id: 60, title: 'Crime' },
  { id: 61, title: 'Documentary' },
  { id: 62, title: 'Drama' },
  { id: 67, title: 'Fantasy' },
  { id: 70, title: 'Horror' },
  { id: 76, title: 'Mystery' },
  { id: 77, title: 'Romance' },
  { id: 78, title: 'Sci-Fi' },
  { id: 79, title: 'Sport' },
  { id: 80, title: 'Thriller' },
  { id: 89, title: 'Western' },
];

const GENRE_ALIASES: Record<string, string> = {
  'science fiction': 'sci-fi',
  scifi: 'sci-fi',
  'sci fi': 'sci-fi',
  sports: 'sport',
  animated: 'animation',
};

export function genreId(name: string): number | null {
  const key = name.trim().toLowerCase();
  const wanted = GENRE_ALIASES[key] ?? key;
  return KNOWN_GENRES.find((g) => g.title.toLowerCase() === wanted)?.id ?? null;
}

export function genreName(id: number): string {
  return KNOWN_GENRES.find((g) => g.id === id)?.title ?? 'Genre';
}

const kindParam = (kind: Kind) => (kind === 'movie' ? 'movies' : 'series');

export function endpoints(level: Level) {
  const API_BASE = apiBase();
  return {
    groups: (lang: 'en' | 'ar') => `${API_BASE}videoGroups/lang/${lang}/level/${level}`,
    banner: () => `${API_BASE}banner/level/${level}`,
    latest: (kind: Kind, page: number, perPage: number) =>
      `${API_BASE}${kind === 'movie' ? 'latestMovies' : 'latestSeries'}/level/${level}/itemsPerPage/${perPage}/page/${page}/`,
    search: (q: string, kind: Kind, page: number) =>
      `${API_BASE}AdvancedSearch?level=${level}&videoTitle=${encodeURIComponent(q)}&type=${kindParam(kind)}&page=${page}`,
    byGenre: (kind: Kind, categoryId: number, page: number) =>
      `${API_BASE}AdvancedSearch?level=${level}&type=${kindParam(kind)}&category_id=${categoryId}&year=2010,2030&page=${page}`,
  };
}

export const getGroups = async (level: Level, lang: 'en' | 'ar' = 'en'): Promise<Group[]> =>
  parseGroups(await fetchJson(endpoints(level).groups(lang)));

export const getBanner = async (level: Level): Promise<Title[]> => parseTitleList(await fetchJson(endpoints(level).banner()));

export const getLatest = async (kind: Kind, level: Level, page = 1, perPage = 30): Promise<Title[]> =>
  parseTitleList(await fetchJson(endpoints(level).latest(kind, page, perPage)));

export async function searchTitles(q: string, kind: Kind, level: Level, page = 0): Promise<Title[]> {
  const query = q.trim();
  if (!query) return [];
  return parseTitleList(await fetchJson(endpoints(level).search(query, kind, page), { persist: false, retries: 2 }));
}

export const getByGenre = async (kind: Kind, categoryId: number, level: Level, page = 0): Promise<Title[]> =>
  parseTitleList(await fetchJson(endpoints(level).byGenre(kind, categoryId, page)));

export async function getCategories(): Promise<Category[]> {
  try {
    const list = parseCategories(await fetchJson(`${apiBase()}mainCategories?lang=en`));
    return list.length ? list : KNOWN_GENRES;
  } catch {
    return KNOWN_GENRES;
  }
}

export const getDetails = async (id: string): Promise<TitleDetails | null> =>
  parseDetails(await fetchJson(`${apiBase()}allVideoInfo/id/${encodeURIComponent(id)}`));

export const getEpisodes = async (seriesId: string): Promise<Title[]> =>
  parseEpisodes(await fetchJson(`${apiBase()}videoSeason/id/${encodeURIComponent(seriesId)}`));

/** Signed CDN links expire, so these are never persisted. */
export const getVideoFiles = async (id: string): Promise<VideoFile[]> =>
  parseVideoFiles(await fetchJson(`${apiBase()}transcoddedFiles/id/${encodeURIComponent(id)}`, { persist: false }));

export const getSubtitleFiles = async (id: string): Promise<SubtitleFiles> =>
  parseSubtitles(await fetchJson(`${apiBase()}translationFiles/id/${encodeURIComponent(id)}`, { persist: false }));
