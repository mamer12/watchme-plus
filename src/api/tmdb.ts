/**
 * TMDB through our own proxy (/api/tmdb). Everything here is optional: when the proxy is down the
 * app simply has no logos, Top 10 or "Because you watched" rows.
 */
import { fetchJson } from './http';
import { searchTitles } from './catalog';
import { findMatch, yearOf, type Candidate } from './match';
import { arr, isObject, num, str } from './parse';
import type { Kind, Level, Title } from './types';
import { readJson, writeJson } from '../lib/storage';
import { limiter } from '../lib/limiter';

const IMG = 'https://image.tmdb.org/t/p/';
const ART_PREFIX = 'wmp:art:';
const MATCH_PREFIX = 'wmp:match:';
const DAY = 86_400_000;
const ART_TTL = 14 * DAY;
const MISS_TTL = 2 * DAY;
const MATCH_TTL = 7 * DAY;
const MAX_FAILURES = 4;

type Media = 'movie' | 'tv';

export interface Art {
  tmdbId: number;
  media: Media;
  backdrop: string | null;
  logoEn: string | null;
  logoAr: string | null;
}

export interface TmdbCandidate extends Candidate {
  tmdbId: number;
  votes?: number;
}

let failures = 0;
const runTmdb = limiter(6);
const runSearch = limiter(4);

export function tmdbAvailable(): boolean {
  return failures < MAX_FAILURES;
}

async function tmdb(path: string): Promise<unknown> {
  if (!tmdbAvailable()) throw new Error('TMDB unavailable');
  try {
    const v = await runTmdb(() => fetchJson(`/api/tmdb?path=${encodeURIComponent(path)}`, { retries: 1, persist: false }));
    failures = 0;
    return v;
  } catch (err) {
    failures += 1;
    throw err;
  }
}

interface ImageInfo {
  path: string;
  lang: string | null;
  width: number;
  votes: number;
}

function images(v: unknown): ImageInfo[] {
  return arr(v)
    .filter(isObject)
    .map((i) => ({
      path: str(i.file_path),
      lang: str(i.iso_639_1) || null,
      width: num(i.width) ?? 0,
      votes: num(i.vote_average) ?? 0,
    }))
    .filter((i) => i.path.startsWith('/'));
}

/** Largest textless backdrop (no language), falling back to any backdrop. */
export function pickBackdrop(raw: unknown): string | null {
  const all = images(raw);
  const textless = all.filter((i) => i.lang === null || i.lang === 'xx');
  const pool = textless.length ? textless : all;
  const best = [...pool].sort((a, b) => b.width - a.width || b.votes - a.votes)[0];
  return best ? `${IMG}w780${best.path}` : null;
}

/** Best logo in a language, preferring PNG and the highest-voted. */
export function pickLogo(raw: unknown, lang: string): string | null {
  const pool = images(raw).filter((i) => i.lang === lang);
  const best = [...pool].sort(
    (a, b) => Number(b.path.endsWith('.png')) - Number(a.path.endsWith('.png')) || b.votes - a.votes || b.width - a.width,
  )[0];
  return best ? `${IMG}w500${best.path}` : null;
}

/** Reads the `/find` answer: the movie or show behind an IMDb id. */
export function parseFind(raw: unknown, kind: Kind): { id: number; media: Media } | null {
  if (!isObject(raw)) return null;
  const movie = arr(raw.movie_results).filter(isObject)[0];
  const tv = arr(raw.tv_results).filter(isObject)[0];
  const episode = arr(raw.tv_episode_results).filter(isObject)[0];
  const order: [unknown, Media][] =
    kind === 'series'
      ? [[tv?.id, 'tv'], [episode?.show_id, 'tv'], [movie?.id, 'movie']]
      : [[movie?.id, 'movie'], [tv?.id, 'tv']];
  for (const [id, media] of order) {
    const n = num(id);
    if (n) return { id: n, media };
  }
  return null;
}

interface Stamped<T> {
  t: number;
  v: T;
}

function cached<T>(key: string, ttl: number, missTtl = ttl): T | null | undefined {
  const e = readJson<Stamped<T | null>>(key);
  if (!e || typeof e.t !== 'number') return undefined;
  const age = Date.now() - e.t;
  if (age > (e.v === null ? missTtl : ttl)) return undefined;
  return e.v;
}

const findMemo = new Map<string, Promise<{ id: number; media: Media } | null>>();

function findTmdb(imdbId: string, kind: Kind) {
  const key = `${kind}:${imdbId}`;
  let p = findMemo.get(key);
  if (!p) {
    p = tmdb(`/find/${imdbId}?external_source=imdb_id`).then((r) => parseFind(r, kind));
    findMemo.set(key, p);
    p.catch(() => findMemo.delete(key));
  }
  return p;
}

const artMemo = new Map<string, Promise<Art | null>>();

export function peekArt(imdbId: string): Art | null | undefined {
  return cached<Art>(ART_PREFIX + imdbId, ART_TTL, MISS_TTL);
}

export function getArt(imdbId: string, kind: Kind): Promise<Art | null> {
  const hit = peekArt(imdbId);
  if (hit !== undefined) return Promise.resolve(hit);
  let p = artMemo.get(imdbId);
  if (p) return p;
  p = (async () => {
    const found = await findTmdb(imdbId, kind);
    let art: Art | null = null;
    if (found) {
      const imgs = await tmdb(`/${found.media}/${found.id}/images?include_image_language=en,ar,null`);
      const o = isObject(imgs) ? imgs : {};
      art = {
        tmdbId: found.id,
        media: found.media,
        backdrop: pickBackdrop(o.backdrops),
        logoEn: pickLogo(o.logos, 'en'),
        logoAr: pickLogo(o.logos, 'ar'),
      };
    }
    writeJson(ART_PREFIX + imdbId, { t: Date.now(), v: art }, ART_PREFIX);
    return art;
  })();
  artMemo.set(imdbId, p);
  p.catch(() => artMemo.delete(imdbId));
  return p;
}

export function parseCandidates(raw: unknown): TmdbCandidate[] {
  const results = isObject(raw) ? arr(raw.results) : [];
  const out: TmdbCandidate[] = [];
  for (const r of results) {
    if (!isObject(r)) continue;
    const tmdbId = num(r.id);
    const name = str(r.title) || str(r.name);
    if (!tmdbId || !name) continue;
    out.push({
      tmdbId,
      name,
      originalName: str(r.original_title) || str(r.original_name) || undefined,
      year: yearOf(r.release_date) ?? yearOf(r.first_air_date),
      votes: num(r.vote_count) ?? 0,
    });
  }
  return out;
}

async function matchOne(c: TmdbCandidate, kind: Kind, level: Level): Promise<Title | null> {
  const key = `${MATCH_PREFIX}${level}:${kind}:${c.tmdbId}`;
  const hit = cached<Title>(key, MATCH_TTL, MISS_TTL);
  if (hit !== undefined) return hit;
  const names = [c.name, c.originalName].filter((n, i, a): n is string => !!n && a.indexOf(n) === i);
  let found: Title | null = null;
  for (const n of names) {
    const results = await runSearch(() => searchTitles(n, kind, level));
    found = findMatch(c, results);
    if (found) break;
  }
  writeJson(key, { t: Date.now(), v: found }, MATCH_PREFIX);
  return found;
}

/** Matches candidates to the catalog in order, keeping at most `limit` titles. */
export async function matchToCatalog(cands: TmdbCandidate[], kind: Kind, level: Level, limit: number): Promise<Title[]> {
  const settled = await Promise.allSettled(cands.slice(0, limit * 2).map((c) => matchOne(c, kind, level)));
  const seen = new Set<string>();
  const out: Title[] = [];
  for (const s of settled) {
    if (s.status !== 'fulfilled' || !s.value || seen.has(s.value.id)) continue;
    seen.add(s.value.id);
    out.push(s.value);
    if (out.length >= limit) break;
  }
  return out;
}

export async function getTrending(kind: Kind): Promise<TmdbCandidate[]> {
  return parseCandidates(await tmdb(`/trending/${kind === 'movie' ? 'movie' : 'tv'}/week`));
}

export async function getRecommendations(imdbId: string, kind: Kind): Promise<TmdbCandidate[]> {
  const found = await findTmdb(imdbId, kind);
  if (!found) return [];
  return parseCandidates(await tmdb(`/${found.media}/${found.id}/recommendations`));
}

/** the catalog genre name → TMDB genre id, per media type (Sport has no TMDB genre). */
const TMDB_MOVIE_GENRES: Record<string, number> = {
  action: 28,
  adventure: 12,
  animation: 16,
  comedy: 35,
  crime: 80,
  documentary: 99,
  drama: 18,
  fantasy: 14,
  horror: 27,
  mystery: 9648,
  romance: 10749,
  'sci-fi': 878,
  thriller: 53,
  western: 37,
};
const TMDB_TV_GENRES: Record<string, number> = {
  action: 10759,
  adventure: 10759,
  animation: 16,
  comedy: 35,
  crime: 80,
  documentary: 99,
  drama: 18,
  mystery: 9648,
  'sci-fi': 10765,
  fantasy: 10765,
  western: 37,
};

export function tmdbGenreIds(genres: string[], kind: Kind): number[] {
  const map = kind === 'movie' ? TMDB_MOVIE_GENRES : TMDB_TV_GENRES;
  const ids = genres.map((g) => map[g.trim().toLowerCase()]).filter((n): n is number => typeof n === 'number');
  return [...new Set(ids)];
}

/** All-time most popular titles (by vote count) in any of the genres ("|" = OR), pages 1–2. */
export async function getPopularAllTime(kind: Kind, genres: string[]): Promise<TmdbCandidate[]> {
  const media = kind === 'movie' ? 'movie' : 'tv';
  const ids = tmdbGenreIds(genres, kind);
  const filter = ids.length ? `&with_genres=${ids.join('|')}` : '';
  const pages = await Promise.allSettled(
    [1, 2].map((page) => tmdb(`/discover/${media}?sort_by=vote_count.desc${filter}&page=${page}`)),
  );
  const seen = new Set<number>();
  const out: TmdbCandidate[] = [];
  for (const p of pages) {
    if (p.status !== 'fulfilled') continue;
    for (const c of parseCandidates(p.value)) {
      if (seen.has(c.tmdbId)) continue;
      seen.add(c.tmdbId);
      out.push(c);
    }
  }
  return out.sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0));
}
