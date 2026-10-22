/**
 * Defensive parser for the catalog's API. Any field may be missing, null, a number or a string,
 * and whole responses may be HTML or the wrong shape. Nothing here throws.
 */
import { imageBase } from './endpoints';
import type { Category, Genre, Group, Kind, Range, SubtitleFiles, Title, TitleDetails, VideoFile } from './types';

type Raw = Record<string, unknown>;

export function isObject(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function str(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function positive(v: unknown): number | null {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
}

export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Absolute http(s) URL, prefixing the image host for bare paths. */
export function url(v: unknown, host = imageBase()): string | null {
  const s = str(v);
  if (!s || s.includes('not_available') || s.startsWith('defaultImages')) return null;
  if (/^https?:\/\//i.test(s)) return s.replace(/^http:\/\//i, 'https://');
  if (s.startsWith('//')) return `https:${s}`;
  return host + s.replace(/^\/+/, '');
}

export function imdbIdFrom(v: unknown): string | null {
  const m = /tt\d{5,10}/.exec(str(v));
  return m ? m[0] : null;
}

function parseGenres(v: unknown): Genre[] {
  const out: Genre[] = [];
  for (const g of arr(v)) {
    if (!isObject(g)) continue;
    const en = str(g.en_title);
    const ar = str(g.ar_title);
    if (en || ar) out.push({ en: en || ar, ar: ar || en });
  }
  return out;
}

export function parseKind(v: unknown): Kind {
  return str(v) === '2' ? 'series' : 'movie';
}

export function parseTitle(raw: unknown): Title | null {
  if (!isObject(raw)) return null;
  const id = str(raw.nb);
  if (!/^\d+$/.test(id)) return null;
  const enTitle = str(raw.en_title) || str(raw.other_title);
  const arTitle = str(raw.ar_title);
  if (!enTitle && !arTitle) return null;
  const main = url(raw.imgObjUrl);
  const isCover = !!main && main.includes('cover-images');
  const medium = url(raw.imgMediumThumbObjUrl);
  const year = positive(raw.year);
  return {
    id,
    kind: parseKind(raw.kind),
    enTitle: enTitle || arTitle,
    arTitle: arTitle || enTitle,
    enContent: str(raw.en_content),
    arContent: str(raw.ar_content),
    year: year !== null ? Math.round(year) : null,
    stars: positive(raw.stars),
    season: positive(raw.season),
    episode: positive(raw.episodeNummer),
    duration: positive(raw.duration),
    poster: isCover ? medium : main ?? medium,
    posterThumb: medium ?? (isCover ? null : main),
    cover: isCover ? main : null,
    imdbId: imdbIdFrom(raw.imdbUrlRef),
    genres: parseGenres(raw.categories),
    filmRating: positive(raw.filmRating),
    seriesRating: positive(raw.seriesRating),
    trailer: str(raw.trailer) || null,
  };
}

/** A list of titles, deduplicated by id, ignoring junk entries. */
export function parseTitleList(raw: unknown): Title[] {
  const list = Array.isArray(raw) ? raw : isObject(raw) && Array.isArray(raw.data) ? raw.data : [];
  const seen = new Set<string>();
  const out: Title[] = [];
  for (const item of list) {
    const t = parseTitle(item);
    if (t && !seen.has(t.id)) {
      seen.add(t.id);
      out.push(t);
    }
  }
  return out;
}

function parseRanges(starts: unknown[], ends: unknown[]): Range[] {
  const out: Range[] = [];
  for (let i = 0; i < starts.length; i++) {
    const start = num(starts[i]);
    const end = num(ends[i]);
    if (start !== null && end !== null && end > start && start >= 0) out.push({ start, end });
  }
  return out.sort((a, b) => a.start - b.start);
}

export function parseDetails(raw: unknown): TitleDetails | null {
  const base = parseTitle(raw);
  if (!base || !isObject(raw)) return null;
  const names = (v: unknown) =>
    arr(v)
      .map((p) => (isObject(p) ? str(p.name).replace(/\s*\(.*\)\s*$/, '') : ''))
      .filter((n): n is string => n.length > 0);
  const intro = arr(raw.introSkipping).filter(isObject);
  const family = isObject(raw.skippingDurations) ? raw.skippingDurations : {};
  return {
    ...base,
    actors: names(raw.actorsInfo),
    directors: names(raw.directorsInfo),
    introSkips: parseRanges(
      intro.map((r) => r.start),
      intro.map((r) => r.end),
    ),
    familySkips: parseRanges(arr(family.start), arr(family.end)),
  };
}

/** All episodes of a series, sorted by season then episode number. */
export function parseEpisodes(raw: unknown): Title[] {
  return parseTitleList(raw).sort(
    (a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0) || Number(a.id) - Number(b.id),
  );
}

export function parseVideoFiles(raw: unknown): VideoFile[] {
  const out: VideoFile[] = [];
  const seen = new Set<number>();
  for (const f of arr(raw)) {
    if (!isObject(f)) continue;
    const resolution = str(f.resolution);
    const height = num(resolution.replace(/p$/i, ''));
    const link = url(f.videoUrl, '');
    if (!height || !link || !/^https:\/\//.test(link) || seen.has(height)) continue;
    seen.add(height);
    out.push({ resolution: `${height}p`, height, url: link });
  }
  return out.sort((a, b) => a.height - b.height);
}

export function parseSubtitles(raw: unknown): SubtitleFiles {
  if (!isObject(raw)) return { ar: null, en: null };
  const pick = (v: unknown) => {
    const u = url(v, '');
    return u && /^https:\/\//.test(u) ? u : null;
  };
  return { ar: pick(raw.arTranslationFilePath), en: pick(raw.enTranslationFilePath) };
}

export function parseGroups(raw: unknown): Group[] {
  const groups = isObject(raw) ? arr(raw.groups) : arr(raw);
  const out: Group[] = [];
  for (const g of groups) {
    if (!isObject(g)) continue;
    const items = parseTitleList(g.content);
    const title = str(g.title);
    if (title && items.length) out.push({ id: str(g.groupsID) || title, title, items });
  }
  return out;
}

export function parseCategories(raw: unknown): Category[] {
  const out: Category[] = [];
  for (const c of arr(raw)) {
    if (!isObject(c)) continue;
    const id = num(c.nb);
    const title = str(c.title);
    if (id !== null && title) out.push({ id, title });
  }
  return out;
}
