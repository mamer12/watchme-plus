/** What a card shows. Pure. */
import type { Title, TitleLang } from '../api/types';
import type { Art } from '../api/tmdb';
import { pickImage } from '../lib/imageVariant';

export type ArtPlan =
  | { type: 'cover'; image: string }
  | { type: 'tmdb'; image: string; logo: string | null }
  | { type: 'poster'; image: string | null };

/**
 * Netflix-style box art: the catalog's wide cover when the title has one (banner titles, logo baked in),
 * else TMDB's textless backdrop with the logo on top, else the poster with the title as text.
 */
export function artPlan(
  t: Pick<Title, 'cover' | 'poster' | 'posterThumb'>,
  art: Art | null | undefined,
  lang: TitleLang,
  /** Slow image host: skip the ~300 KB cover on cards and use the small poster. */
  lite = false,
): ArtPlan {
  if (lite && !art?.backdrop) return { type: 'poster', image: pickImage(t, 'card').src };
  if (t.cover && !lite) return { type: 'cover', image: t.cover };
  if (art?.backdrop) {
    const logo = lang === 'ar' ? art.logoAr ?? art.logoEn : art.logoEn ?? art.logoAr;
    return { type: 'tmdb', image: art.backdrop, logo };
  }
  return { type: 'poster', image: pickImage(t, 'card').src };
}
