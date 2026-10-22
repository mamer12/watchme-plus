import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { Kind, Title } from '../api/types';
import { getBanner, getLatest, getVideoFiles } from '../api/catalog';
import { canPreview, PREVIEW_DELAY_MS } from '../features/home/preview';
import { getIsp } from '../api/endpoints';
import { isAdaptive } from '../lib/adaptiveQuality';
import { previewFile } from '../features/player/logic';
import { useArt } from './BoxArt';
import { useCanHover, useIsDesktop, useReducedMotion, saveData } from '../hooks/useMedia';
import { useQuery } from '../hooks/useQuery';
import { useTitleActions } from '../hooks/useTitleActions';
import { displayTitle, runtime, synopsis } from '../lib/format';
import { allowedAtLevel } from '../lib/ratings';
import { startPosition } from '../state/library';
import { getState, useLibrary } from '../state/store';
import { AgeBadge } from './Badges';
import { InfoIcon, PlayIcon, VolumeIcon } from './Icons';
import { Img } from './Img';

const ROTATE_MS = 10_000;
const MAX_PREVIEW_MS = 60_000;
const MAX_ITEMS = 10;

function useBillboardItems(kind: Kind | null) {
  const level = useLibrary((s) => s.settings.level);
  return useQuery(`billboard:${kind ?? 'all'}:${level}`, async () => {
    let items: Title[] = [];
    try {
      items = (await getBanner(level)).filter((t) => (!kind || t.kind === kind) && t.cover);
    } catch {
      /* fall through to latest */
    }
    if (items.length < 3 && kind) items = [...items, ...(await getLatest(kind, level, 1, 12))];
    return items.filter((t) => allowedAtLevel(t, level)).slice(0, MAX_ITEMS);
  });
}

function Slide({ title, active, first }: { title: Title; active: boolean; first: boolean }) {
  // A slide's big image is only asked for once it is on screen: one cover at a time.
  const [shown, setShown] = useState(active);
  if (active && !shown) setShown(true);
  const art = useArt(title, active);
  const image = title.cover ?? art?.backdrop ?? title.poster;
  return (
    <div className={`billboard__slide ${active ? 'is-active' : ''}`} aria-hidden={!active}>
      {shown && (
        <Img src={image} alt="" eager={active} priority={active && first} width={1280} height={720} className={title.cover || art?.backdrop ? '' : 'billboard__poster'} />
      )}
    </div>
  );
}

/** The big rotating hero at the top of Home, Movies and Series. */
export function Billboard({ kind = null }: { kind?: Kind | null }) {
  const { data } = useBillboardItems(kind);
  const items = data ?? [];
  const [index, setIndex] = useState(0);
  const [preview, setPreview] = useState<{ id: string; src: string; start: number } | null>(null);
  const [muted, setMuted] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [held, setHeld] = useState(false);
  const modalOpen = useLocation().pathname.startsWith('/title/');
  const paused = hidden || modalOpen;
  const video = useRef<HTMLVideoElement>(null);
  const root = useRef<HTMLElement>(null);
  const desktop = useIsDesktop();
  const canHover = useCanHover();
  const reducedMotion = useReducedMotion();
  const settings = useLibrary((s) => s.settings);
  const lang = settings.titleLang;
  const { play, openInfo } = useTitleActions();
  const current = items[index % Math.max(1, items.length)];
  const art = useArt(current ?? { id: '', imdbId: null, kind: 'movie', cover: null }, !!current && !current.cover);
  const previewOk = canPreview({ desktop, canHover, saveData: saveData(), reducedMotion, enabled: settings.previewAutoplay });

  const next = useCallback(() => {
    setPreview(null);
    setIndex((i) => (items.length ? (i + 1) % items.length : 0));
  }, [items.length]);
  const prev = useCallback(() => {
    setPreview(null);
    setIndex((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
  }, [items.length]);
  // Swipe on touch screens: a mostly sideways move of 40px or more turns the carousel.
  const touch = useRef<{ x: number; y: number } | null>(null);

  // Rotate while no preview is playing and nobody is pointing at or focused inside the billboard.
  useEffect(() => {
    if (items.length < 2 || preview || paused || held || reducedMotion) return;
    const t = setTimeout(next, ROTATE_MS);
    return () => clearTimeout(t);
  }, [index, items.length, preview, paused, held, reducedMotion, next]);

  // Muted preview on desktop after a short delay.
  useEffect(() => {
    // The mirror's files are slow: a preview would compete with the poster downloads and the player.
    if (!previewOk || !current || paused || isAdaptive(getIsp())) return;
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const file = previewFile(await getVideoFiles(current.id));
        if (!alive || !file) return;
        // Resume point, unless it's near the end (the preview would end at once).
        const resume = startPosition(getState(), current.id);
        const nearEnd = current.duration !== null && resume > current.duration * 0.85;
        setPreview({ id: current.id, src: file.url, start: nearEnd ? 0 : resume });
      } catch {
        /* no preview: the still stays */
      }
    }, PREVIEW_DELAY_MS);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [previewOk, current, paused]);

  useEffect(() => {
    if (!preview) return;
    const t = setTimeout(next, MAX_PREVIEW_MS);
    return () => clearTimeout(t);
  }, [preview, next]);

  // Stop when the billboard scrolls away or the tab is hidden.
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setHidden(!e?.isIntersecting || (e?.intersectionRatio ?? 0) < 0.4), {
      threshold: [0, 0.4, 1],
    });
    io.observe(el);
    const onVis = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [items.length]);

  useEffect(() => {
    if (paused && preview) setPreview(null);
  }, [paused, preview]);

  if (!data) {
    return <section className="billboard billboard--loading" aria-busy="true" aria-label="Featured" />;
  }
  if (!current) return <div className="billboard-spacer" />;

  const name = displayTitle(current, lang);
  const text = synopsis(current, lang);
  const logo = !current.cover ? (lang === 'ar' ? art?.logoAr ?? art?.logoEn : art?.logoEn ?? art?.logoAr) : null;
  const length = current.kind === 'series' ? 'Series' : runtime(current.duration);

  return (
    <section
      ref={root}
      className="billboard"
      aria-roledescription="carousel"
      aria-label="Featured titles"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onTouchStart={(e) => {
        const p = e.touches[0];
        touch.current = p ? { x: p.clientX, y: p.clientY } : null;
      }}
      onTouchEnd={(e) => {
        const start = touch.current, p = e.changedTouches[0];
        touch.current = null;
        if (!start || !p || items.length < 2) return;
        const dx = p.clientX - start.x, dy = p.clientY - start.y;
        if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        if (dx < 0) next();
        else prev();
      }}
      onFocus={() => setHeld(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false);
      }}
    >
      <div className="billboard__media">
        {items.map((t, i) => (
          <Slide key={t.id} title={t} active={i === index % items.length} first={i === 0} />
        ))}
        {preview && preview.id === current.id && (
          <video
            ref={video}
            className="billboard__video"
            src={preview.src}
            muted={muted}
            autoPlay
            playsInline
            preload="auto"
            onLoadedMetadata={(e) => {
              if (preview.start > 0) e.currentTarget.currentTime = preview.start;
            }}
            onEnded={next}
            onError={() => setPreview(null)}
          />
        )}
        <div className="billboard__shade" />
      </div>
      <div className="billboard__info" key={current.id}>
        {logo ? (
          <img className="billboard__logo" src={logo} alt={name} />
        ) : (
          <h2 className={`billboard__title ${current.cover ? 'billboard__title--small' : ''}`} dir="auto">
            {name}
          </h2>
        )}
        <div className="meta">
          {current.year && <span>{current.year}</span>}
          <AgeBadge title={current} />
          {length && <span>{length}</span>}
        </div>
        {text && (
          <p className="billboard__synopsis" dir="auto">
            {text}
          </p>
        )}
        <div className="billboard__buttons">
          <button type="button" className="btn btn--play" onClick={() => play(current)}>
            <PlayIcon size={24} /> Play
          </button>
          <button type="button" className="btn btn--info" onClick={() => openInfo(current)}>
            <InfoIcon size={24} /> More Info
          </button>
        </div>
      </div>
      <div className="billboard__side">
        {preview && (
          <button type="button" className="icon-btn icon-btn--round icon-btn--ghost" aria-label={muted ? 'Unmute' : 'Mute'} onClick={() => setMuted((m) => !m)}>
            <VolumeIcon size={20} level={muted ? 0 : 1} />
          </button>
        )}
        <AgeBadge title={current} />
      </div>
      {items.length > 1 && (
        <div className="billboard__dots" role="group" aria-label="Choose a featured title">
          {items.map((t, i) => (
            <button
              key={t.id}
              type="button"
              aria-current={i === index % items.length}
              aria-label={`Show ${displayTitle(t, lang)}`}
              className="billboard__dot"
              onClick={() => {
                setPreview(null);
                setIndex(i);
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
