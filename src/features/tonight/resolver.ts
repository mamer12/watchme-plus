/** Filters -> real titles available in the catalog, ranked by taste, each with a one-line reason. */
import { genreId, getByGenre } from '../../api/catalog';
import { fetchJson } from '../../api/http';
import { matchToCatalog, parseCandidates, tmdbAvailable, type TmdbCandidate } from '../../api/tmdb';
import type { Kind, Level, Title } from '../../api/types';
import { allowedAtLevel } from '../../lib/ratings';
import { scoreTitle, type Affinity } from '../../lib/recommend';
import { pick } from './text';
import type { Lang, TonightFilters } from './types';

export const RESULT_LIMIT = 12;
const MIN_VOTES = 150;
const PER_KIND = 18;

/** Genre name -> TMDB genre id, per media type (the app's own mapping lacks family, history, music and war). */
const GENRE_IDS: Record<'movie' | 'tv', Record<string, number>> = {
  movie: { action: 28, adventure: 12, animation: 16, comedy: 35, crime: 80, documentary: 99, drama: 18, family: 10751, fantasy: 14, history: 36, horror: 27, music: 10402, mystery: 9648, romance: 10749, 'sci-fi': 878, thriller: 53, war: 10752, western: 37 },
  tv: { action: 10759, adventure: 10759, animation: 16, comedy: 35, crime: 80, documentary: 99, drama: 18, family: 10751, fantasy: 10765, mystery: 9648, 'sci-fi': 10765, war: 10768, western: 37 },
};

const idsFor = (names: string[], media: 'movie' | 'tv'): number[] => [...new Set(names.map((g) => GENRE_IDS[media][g]).filter((n): n is number => typeof n === 'number'))];

/** The TMDB discover path (page 1) for these filters. Only characters the proxy allows. */
export function discoverPath(f: TonightFilters, media: 'movie' | 'tv', page = 1): string {
  const q: string[] = ['sort_by=popularity.desc', `vote_count.gte=${MIN_VOTES}`];
  const withIds = idsFor(f.genres, media);
  const withoutIds = idsFor(f.excludeGenres, media).filter((id) => !withIds.includes(id));
  if (withIds.length) q.push(`with_genres=${withIds.join('|')}`);
  if (withoutIds.length) q.push(`without_genres=${withoutIds.join(',')}`);
  if (f.maxMinutes !== undefined) q.push(`with_runtime.lte=${f.maxMinutes}`);
  const from = media === 'movie' ? 'primary_release_date' : 'first_air_date';
  if (f.minYear !== undefined) q.push(`${from}.gte=${f.minYear}-01-01`);
  if (f.maxYear !== undefined) q.push(`${from}.lte=${f.maxYear}-12-31`);
  if (f.lang) q.push(`with_original_language=${f.lang}`);
  q.push(`page=${page}`);
  return `/discover/${media}?${q.join('&')}`;
}

export interface TonightPick {
  title: Title;
  reason: string;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Hard filters on matched catalog titles. Runtime applies to films only (a series' duration is one episode). */
export function filterTitles(titles: Title[], f: TonightFilters, exclude: Set<string>, level: Level): Title[] {
  const banned = new Set(f.excludeGenres.map(norm));
  const seen = new Set<string>();
  return titles.filter((t) => {
    if (seen.has(t.id) || exclude.has(t.id) || !allowedAtLevel(t, level)) return false;
    seen.add(t.id);
    if (f.type === 'movie' && t.kind !== 'movie') return false;
    if (f.type === 'tv' && t.kind !== 'series') return false;
    if (t.genres.some((g) => banned.has(norm(g.en)))) return false;
    if (f.minYear !== undefined && t.year !== null && t.year < f.minYear) return false;
    if (f.maxYear !== undefined && t.year !== null && t.year > f.maxYear) return false;
    if (f.maxMinutes !== undefined && t.kind === 'movie' && t.duration !== null && t.duration > f.maxMinutes * 60) return false;
    return true;
  });
}

const GENRE_MATCH_WEIGHT = 4;
const KEYWORD_WEIGHT = 0.5;

export function scoreFor(t: Title, f: TonightFilters, affinity: Affinity): number {
  let s = scoreTitle(t, affinity);
  const wanted = new Set(f.genres.map(norm));
  for (const g of t.genres) if (wanted.has(norm(g.en))) s += GENRE_MATCH_WEIGHT;
  const text = `${t.enContent} ${t.enTitle}`.toLowerCase();
  for (const k of f.keywords) if (k && text.includes(k)) s += KEYWORD_WEIGHT;
  return s;
}

/** Ranks titles by taste and the filters, best first. */
export function rankTitles(titles: Title[], f: TonightFilters, affinity: Affinity): Title[] {
  return titles
    .map((t, i) => ({ t, s: scoreFor(t, f, affinity), i }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.t);
}

const genreLabel = (t: Title, en: string, lang: Lang): string => {
  const g = t.genres.find((x) => norm(x.en) === en);
  return lang === 'ar' ? g?.ar || g?.en || en : g?.en || en;
};

/** One line, built from what actually matched (never invented). */
export function reasonFor(t: Title, f: TonightFilters, affinity: Affinity, lang: Lang): string {
  const wanted = new Set(f.genres.map(norm));
  const hit = t.genres.map((g) => norm(g.en)).filter((g) => wanted.has(g)).slice(0, 2);
  if (hit.length) {
    const names = hit.map((g) => genreLabel(t, g, lang)).join(lang === 'ar' ? ' و' : ' + ');
    return pick({ en: `Matches your mood: ${names}`, ar: `يناسب مزاجك: ${names}` }, lang);
  }
  const liked = t.genres.map((g) => norm(g.en)).filter((g) => (affinity.get(g) ?? 0) > 0).sort((a, b) => (affinity.get(b) ?? 0) - (affinity.get(a) ?? 0))[0];
  if (liked) return pick({ en: `You like ${genreLabel(t, liked, lang)}`, ar: `تحب ${genreLabel(t, liked, lang)}` }, lang);
  if (f.maxMinutes !== undefined && t.kind === 'movie' && t.duration !== null) {
    const m = Math.round(t.duration / 60);
    return pick({ en: `Fits your time: ${m} min`, ar: `يناسب وقتك: ${m} دقيقة` }, lang);
  }
  if (t.stars !== null && t.stars >= 7) return pick({ en: `Highly rated: ${t.stars.toFixed(1)}`, ar: `تقييمه عالي: ${t.stars.toFixed(1)}` }, lang);
  return pick({ en: 'Popular right now', ar: 'مطلوب هالأيام' }, lang);
}

/** Loosens the filters a step at a time when nothing matched: drops limits first, then genre exclusions, then genres. */
export function relax(f: TonightFilters): TonightFilters | null {
  if (f.maxMinutes !== undefined || f.minYear !== undefined || f.maxYear !== undefined || f.lang !== undefined) {
    const { maxMinutes: _m, minYear: _a, maxYear: _b, lang: _l, ...rest } = f;
    return rest;
  }
  if (f.excludeGenres.length) return { ...f, excludeGenres: [] };
  if (f.genres.length) return { ...f, genres: [], keywords: [] };
  return null;
}

export interface ResolveDeps {
  level: Level;
  affinity: Affinity;
  exclude: Set<string>;
  lang: Lang;
  /** TMDB candidates for a discover path (default: the app's TMDB proxy). */
  discover?: (path: string) => Promise<TmdbCandidate[]>;
  match?: (c: TmdbCandidate[], kind: Kind, level: Level, limit: number) => Promise<Title[]>;
  /** Used when TMDB is down: catalog titles for a genre category and kind. */
  catalogGenre?: (kind: Kind, categoryId: number, level: Level) => Promise<Title[]>;
}

const defaultDiscover = async (path: string): Promise<TmdbCandidate[]> => {
  if (!tmdbAvailable()) throw new Error('TMDB unavailable');
  return parseCandidates(await fetchJson(`/api/tmdb?path=${encodeURIComponent(path)}`, { retries: 1, persist: false }));
};

async function candidatesFor(f: TonightFilters, kind: Kind, d: ResolveDeps): Promise<Title[]> {
  const media = kind === 'movie' ? 'movie' : 'tv';
  try {
    const pages = await Promise.all([1, 2].map((p) => (d.discover ?? defaultDiscover)(discoverPath(f, media, p))));
    const seen = new Set<number>();
    const cands = pages.flat().filter((c) => !seen.has(c.tmdbId) && !!seen.add(c.tmdbId));
    return await (d.match ?? matchToCatalog)(cands, kind, d.level, PER_KIND);
  } catch {
    // TMDB is down or unconfigured: browse the catalog's own genre lists instead.
    const ids = f.genres.map((g) => genreId(g)).filter((n): n is number => n !== null).slice(0, 2);
    const lists = await Promise.allSettled(ids.map((id) => (d.catalogGenre ?? getByGenre)(kind, id, d.level)));
    return lists.flatMap((l) => (l.status === 'fulfilled' ? l.value : []));
  }
}

/** Real catalog titles for the filters, best first, each with a reason. Relaxes the filters once if nothing matched. */
export async function resolvePicks(filters: TonightFilters, d: ResolveDeps): Promise<TonightPick[]> {
  for (let f: TonightFilters | null = filters; f; f = relax(f)) {
    const kinds: Kind[] = f.type === 'movie' ? ['movie'] : f.type === 'tv' ? ['series'] : ['movie', 'series'];
    const lists = await Promise.all(kinds.map((k) => candidatesFor(f!, k, d)));
    const good = filterTitles(lists.flat(), f, d.exclude, d.level);
    if (good.length) {
      const ranked = rankTitles(good, f, d.affinity).slice(0, RESULT_LIMIT);
      return ranked.map((title) => ({ title, reason: reasonFor(title, f!, d.affinity, d.lang) }));
    }
  }
  return [];
}
