export type Kind = 'movie' | 'series';
export type Level = 0 | 2 | 3;
export type TitleLang = 'en' | 'ar';

export interface Genre {
  en: string;
  ar: string;
}

/** A catalog item as the UI uses it. Every field the API may omit is nullable or has an empty default. */
export interface Title {
  id: string;
  kind: Kind;
  enTitle: string;
  arTitle: string;
  enContent: string;
  arContent: string;
  year: number | null;
  stars: number | null;
  season: number | null;
  episode: number | null;
  /** seconds */
  duration: number | null;
  poster: string | null;
  posterThumb: string | null;
  /** Wide 16:9 cover with the title logo baked in (banner items only). */
  cover: string | null;
  imdbId: string | null;
  genres: Genre[];
  filmRating: number | null;
  seriesRating: number | null;
  trailer: string | null;
}

export interface Range {
  start: number;
  end: number;
}

export interface TitleDetails extends Title {
  actors: string[];
  directors: string[];
  introSkips: Range[];
  familySkips: Range[];
}

export interface VideoFile {
  resolution: string;
  height: number;
  url: string;
}

export interface SubtitleFiles {
  ar: string | null;
  en: string | null;
}

export interface Group {
  id: string;
  title: string;
  items: Title[];
}

export interface Category {
  id: number;
  title: string;
}
