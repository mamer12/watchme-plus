import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type { Title } from '../../api/types';
import { getByGenre, getDetails, getEpisodes } from '../../api/catalog';
import { AgeBadge, HdBadge } from '../../components/Badges';
import { useArt } from '../../components/BoxArt';
import { CloseIcon, PlayIcon, VolumeIcon } from '../../components/Icons';
import { Img } from '../../components/Img';
import { saveData, useReducedMotion } from '../../hooks/useMedia';
import { ListButton } from '../../components/ListButton';
import { RateButton } from '../../components/RateButton';
import { Spinner } from '../../components/Skeleton';
import { TitleGrid } from '../../components/TitleGrid';
import { useQuery } from '../../hooks/useQuery';
import { useTitleActions, type ModalState } from '../../hooks/useTitleActions';
import { displayTitle, episodeLabel, minutesLeft, runtime, seasonsLabel, synopsis, youtubeId } from '../../lib/format';
import { allowedAtLevel } from '../../lib/ratings';
import { whenIdle, warmPlayback } from '../../lib/warmPlayback';
import { resumeFor } from '../../state/library';
import { useLibrary } from '../../state/store';
import { seasonsOf } from '../player/logic';
import { Episodes } from './Episodes';
import { moreLikeThisQuery } from './moreLikeThis';
import { shouldAutoplayTrailer, trailerCommand, trailerSrc, TRAILER_DELAY_MS } from './trailerLogic';

/** The trailer, cross-fading over the hero photo once it has been up for a moment. Any failure leaves the photo. */
function HeroTrailer({ id, name, imageLoaded, playing }: { id: string | null; name: string; imageLoaded: boolean; playing: boolean }) {
  const enabled = useLibrary((s) => s.settings.previewAutoplay);
  const reducedMotion = useReducedMotion();
  const [elapsed, setElapsed] = useState(0);
  const [hidden, setHidden] = useState(() => document.hidden);
  const [muted, setMuted] = useState(true);
  const [shown, setShown] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!imageLoaded || !id) return;
    const t = window.setTimeout(() => setElapsed(TRAILER_DELAY_MS), TRAILER_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [imageLoaded, id]);

  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const on = shouldAutoplayTrailer({ trailerId: id, enabled, reducedMotion, saveData: saveData(), imageLoaded, elapsedMs: elapsed, playing, hidden });
  useEffect(() => {
    if (!on) setShown(false);
  }, [on]);

  const send = (func: Parameters<typeof trailerCommand>[0]) => frame.current?.contentWindow?.postMessage(trailerCommand(func), 'https://www.youtube-nocookie.com');
  // The iframe stays mounted while paused (hidden tab); it unmounts when the player opens or the modal closes.
  const mounted = id && enabled && !reducedMotion && !playing && elapsed >= TRAILER_DELAY_MS;
  useEffect(() => {
    if (shown) send(hidden ? 'pauseVideo' : 'playVideo');
  }, [hidden, shown]);

  if (!id || !mounted) return null;
  return (
    <>
      <div className={`modal__trailer ${shown ? 'modal__trailer--on' : ''}`} aria-hidden="true">
        <iframe
          ref={frame}
          src={trailerSrc(id, window.location.origin)}
          title={`${name} trailer`}
          tabIndex={-1}
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => setShown(true)}
        />
      </div>
      {shown && (
        <button
          type="button"
          className="modal__mute icon-btn icon-btn--round icon-btn--ghost"
          aria-label={muted ? 'Unmute trailer' : 'Mute trailer'}
          onClick={() => {
            send(muted ? 'unMute' : 'mute');
            setMuted(!muted);
          }}
        >
          <VolumeIcon size={20} level={muted ? 0 : 1} />
        </button>
      )}
    </>
  );
}

function MoreLikeThis({ title }: { title: Title }) {
  const level = useLibrary((s) => s.settings.level);
  const q = moreLikeThisQuery(title);
  const { data } = useQuery(`genre:${level}:${q.kind}:${q.genreId}`, () => getByGenre(q.kind, q.genreId, level));
  const items = (data ?? []).filter((t) => t.id !== title.id && allowedAtLevel(t, level)).slice(0, 12);
  if (!items.length) return null;
  return (
    <section className="more-like">
      <h3>More Like This</h3>
      <TitleGrid items={items} label="More like this" />
    </section>
  );
}

/** "More Info": a modal over the page it was opened from, or a page of its own when deep-linked. */
export function TitleModal() {
  const { id = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as ModalState | null;
  const preview = state?.title?.id === id ? state.title : undefined;
  const backdrop = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const settings = useLibrary((s) => s.settings);
  const lib = useLibrary((s) => s);
  const { play: startPlay } = useTitleActions();
  const [playing, setPlaying] = useState(false);
  const [imageLoadedFor, setImageLoadedFor] = useState('');
  const play: typeof startPlay = (...a) => {
    setPlaying(true);
    return startPlay(...a);
  };

  const details = useQuery(`details:${id}`, () => getDetails(id));
  const title: Title | undefined = details.data ?? preview;
  const isSeries = title?.kind === 'series';
  const episodes = useQuery(isSeries ? `eps:${id}` : null, () => getEpisodes(id));
  const eps = episodes.data ?? [];
  const seriesKey = eps[0]?.id ?? id;
  const art = useArt(title ?? { id, imdbId: null, kind: 'movie', cover: null }, !!title);

  const close = () => {
    if (state?.background) navigate(-1);
    else navigate('/', { replace: true });
  };

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus({ preventScroll: true });
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // The page behind is inert while the dialog is open.
    const app = document.querySelector('.app');
    app?.setAttribute('inert', '');
    return () => {
      document.body.style.overflow = prev;
      app?.removeAttribute('inert');
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    backdrop.current?.scrollTo({ top: 0 });
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const resume = useMemo(() => (title ? resumeFor(lib, title, seriesKey) : null), [lib, title, seriesKey]);

  // While the page is open, get the file the Play button will start with ready (mirror only).
  const warmId = title ? resume?.videoId ?? (isSeries ? eps[0]?.id : id) : undefined;
  useEffect(() => {
    if (warmId) whenIdle(() => warmPlayback(warmId));
  }, [warmId]);
  const lang = settings.titleLang;

  let body: JSX.Element;
  if (!title) {
    body = details.loading ? (
      <div className="modal__loading">
        <Spinner />
      </div>
    ) : (
      <div className="modal__empty">
        <h2>We couldn't load this title.</h2>
        <p>Check your connection and try again.</p>
      </div>
    );
  } else if (!allowedAtLevel(title, settings.level)) {
    body = (
      <div className="modal__empty">
        <h2>Not available with your family filter</h2>
        <p>Change the family filter in Settings to see this title.</p>
      </div>
    );
  } else {
    const name = displayTitle(title, lang);
    const text = synopsis(title, lang);
    const seasonCount = eps.length ? seasonsOf(eps).length : null;
    const length = isSeries ? (seasonCount ? seasonsLabel(seasonCount) : null) : runtime(title.duration);
    const heroImage = title.cover ?? art?.backdrop ?? title.poster;
    const logo = !title.cover ? (lang === 'ar' ? art?.logoAr ?? art?.logoEn : art?.logoEn ?? art?.logoAr) : null;
    const playLabel = resume ? (isSeries ? `Resume ${episodeLabel(resume.season, resume.episode) ?? ''}` : 'Resume') : 'Play';
    const firstEpisode = eps[0];
    const d = details.data;

    body = (
      <>
        <div className="modal__hero" onLoadCapture={() => setImageLoadedFor(id)}>
          <Img src={heroImage} alt="" eager className={title.cover || art?.backdrop ? '' : 'modal__hero-poster'} />
          <HeroTrailer id={youtubeId(title.trailer)} name={name} imageLoaded={imageLoadedFor === id} playing={playing} />
          <div className="modal__hero-shade" />
          <div className="modal__hero-info">
            {logo ? (
              <img className="modal__logo" src={logo} alt={name} />
            ) : (
              <h2 className={`modal__title ${title.cover ? 'modal__title--small' : ''}`} dir="auto">
                {name}
              </h2>
            )}
            <div className="modal__actions">
              <button type="button" className="btn btn--play" onClick={() => play(title, resume ? { videoId: resume.videoId } : firstEpisode ? { videoId: firstEpisode.id } : {})}>
                <PlayIcon size={24} /> {playLabel}
              </button>
              {resume && (
                <button
                  type="button"
                  className="btn btn--info"
                  onClick={() => play(title, { videoId: isSeries ? firstEpisode?.id ?? title.id : title.id, restart: true })}
                >
                  Restart
                </button>
              )}
              <ListButton title={title} />
              <RateButton title={title} />
            </div>
            {resume?.remaining != null && resume.position > 0 && (
              <div className="modal__resume">
                <span className="progress progress--inline">
                  <span style={{ width: `${Math.min(100, (resume.position / (resume.position + resume.remaining)) * 100)}%` }} />
                </span>
                <span>{minutesLeft(resume.remaining)}</span>
              </div>
            )}
          </div>
        </div>
        <div className="modal__content">
          <div className="modal__main">
            <div className="meta">
              {title.year && <span>{title.year}</span>}
              <AgeBadge title={title} />
              {length && <span>{length}</span>}
              <HdBadge />
            </div>
            {text && (
              <p className="modal__synopsis" dir="auto">
                {text}
              </p>
            )}
          </div>
          <dl className="modal__facts">
            {d && d.actors.length > 0 && (
              <div>
                <dt>Cast:</dt>
                <dd>{d.actors.slice(0, 6).join(', ')}</dd>
              </div>
            )}
            {d && d.directors.length > 0 && (
              <div>
                <dt>{d.directors.length > 1 ? 'Directors:' : 'Director:'}</dt>
                <dd>{d.directors.join(', ')}</dd>
              </div>
            )}
            {title.genres.length > 0 && (
              <div>
                <dt>Genres:</dt>
                <dd>{title.genres.map((g) => (lang === 'ar' ? g.ar : g.en)).join(', ')}</dd>
              </div>
            )}
            {title.stars && (
              <div>
                <dt>IMDb:</dt>
                <dd>{title.stars.toFixed(1)} / 10</dd>
              </div>
            )}
          </dl>
        </div>
        {isSeries && (episodes.loading ? <Spinner /> : eps.length > 0 && <Episodes episodes={eps} currentId={resume?.videoId ?? null} onPlay={(e) => play(title, { videoId: e.id })} />)}
        <MoreLikeThis title={title} />
        <section className="modal__about">
          <h3>
            About <strong dir="auto">{name}</strong>
          </h3>
          {d && d.actors.length > 6 && (
            <p>
              <span className="dim">Cast: </span>
              {d.actors.join(', ')}
            </p>
          )}
          <p>
            <span className="dim">Maturity rating: </span>
            <AgeBadge title={title} /> {!title.filmRating && !title.seriesRating && 'Not rated'}
          </p>
          {title.imdbId && (
            <p>
              <a className="link" href={`https://www.imdb.com/title/${title.imdbId}/`} target="_blank" rel="noreferrer noopener">
                View on IMDb
              </a>
            </p>
          )}
        </section>
      </>
    );
  }

  return (
    <div ref={backdrop} className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()} data-nav-scope>
      <button ref={closeBtn} type="button" className="modal__close icon-btn icon-btn--round" aria-label="Close" onClick={close}>
        <CloseIcon size={22} />
      </button>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title ? displayTitle(title, lang) : 'Title details'}>
        {body}
      </div>
    </div>
  );
}
