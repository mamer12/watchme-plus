import { useEffect, useRef, useState } from 'react';
import type { Title } from '../api/types';
import { getArt, peekArt, tmdbAvailable, type Art } from '../api/tmdb';
import { useInView } from '../hooks/useInView';
import { displayTitle } from '../lib/format';
import { useLibrary } from '../state/store';
import { useIsp } from '../hooks/useIsp';
import { isAdaptive } from '../lib/adaptiveQuality';
import { pickImage } from '../lib/imageVariant';
import { artPlan } from './boxArt';
import { Img } from './Img';

interface Props {
  title: Title;
  /** 'wide' = 16:9 box art (desktop), 'poster' = 2:3 (mobile rows, Top 10). */
  variant?: 'wide' | 'poster';
  eager?: boolean;
  className?: string;
}

/** Loads TMDB art for a title once `enabled` (near the viewport). Follows title changes. */
export function useArt(title: Pick<Title, 'id' | 'imdbId' | 'kind' | 'cover'>, enabled: boolean): Art | null | undefined {
  const initial = (): Art | null | undefined => (title.imdbId && !title.cover ? peekArt(title.imdbId) : null);
  const [state, setState] = useState<{ id: string; art: Art | null | undefined }>(() => ({ id: title.id, art: initial() }));
  const current = state.id === title.id ? state : { id: title.id, art: initial() };
  if (current !== state) setState(current);

  useEffect(() => {
    const imdb = title.imdbId;
    const id = title.id;
    if (!enabled || title.cover || !imdb || current.art !== undefined) return;
    if (!tmdbAvailable()) {
      setState({ id, art: null });
      return;
    }
    let alive = true;
    getArt(imdb, title.kind).then(
      (a) => alive && setState({ id, art: a }),
      () => alive && setState({ id, art: null }),
    );
    return () => {
      alive = false;
    };
  }, [enabled, title.id, title.imdbId, title.kind, title.cover, current.art]);
  return current.art;
}

export function BoxArt({ title, variant = 'wide', eager = false, className = '' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const lang = useLibrary((s) => s.settings.titleLang);
  const lite = isAdaptive(useIsp());
  const inView = useInView(ref, '600px');
  const art = useArt(title, variant === 'wide' && (inView || eager));
  const name = displayTitle(title, lang);
  // A broken TMDB backdrop falls back to the poster.
  const [broken, setBroken] = useState<string | null>(null);

  const card = pickImage(title, 'card');
  if (variant === 'poster') {
    return (
      <div ref={ref} className={`boxart boxart--poster ${className}`}>
        <Img src={card.src} fallback={card.fallback} eager={eager} width={293} height={439} alt="" />
        {!card.src && <span className="boxart__name" dir="auto">{name}</span>}
      </div>
    );
  }

  const pending = !title.cover && !!title.imdbId && art === undefined;
  const usable = art && art.backdrop !== broken ? art : null;
  const plan = artPlan(title, pending ? null : usable, lang, lite);
  return (
    <div ref={ref} className={`boxart boxart--wide ${className}`}>
      {pending ? null : plan.type === 'poster' ? (
        <>
          <Img src={plan.image} fallback={card.fallback} eager={eager} width={293} height={439} alt="" className="boxart__poster" />
          <span className="boxart__shade" />
          <span className="boxart__name" dir="auto">
            {name}
          </span>
        </>
      ) : (
        <>
          <Img src={plan.image} eager={eager} width={320} height={180} alt="" onFail={plan.type === 'tmdb' ? () => setBroken(plan.image) : undefined} />
          {plan.type === 'tmdb' &&
            (plan.logo ? (
              <Img src={plan.logo} alt="" className="boxart__logo" eager={eager} />
            ) : (
              <span className="boxart__name" dir="auto">
                {name}
              </span>
            ))}
        </>
      )}
    </div>
  );
}
