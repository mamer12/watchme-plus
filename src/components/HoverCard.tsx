import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Title } from '../api/types';
import { getEpisodes } from '../api/catalog';
import { useQuery } from '../hooks/useQuery';
import { useTitleActions } from '../hooks/useTitleActions';
import { runtime, seasonsLabel, youtubeId } from '../lib/format';
import { saveData, useCanHover, useReducedMotion } from '../hooks/useMedia';
import { useLibrary } from '../state/store';
import { trailerSrc } from '../features/title/trailerLogic';
import { HOVER_TRAILER_MS, shouldPreviewTrailer } from './hoverLogic';
import { seasonsOf } from '../features/player/logic';
import { AgeBadge, HdBadge } from './Badges';
import { BoxArt } from './BoxArt';
import { ChevronDownIcon, PlayIcon } from './Icons';
import { ListButton } from './ListButton';
import { RateButton } from './RateButton';

const SCALE = 1.5;
const MARGIN = 16;

interface Props {
  title: Title;
  anchor: DOMRect;
  progress?: number;
  label?: string | null;
  onPlay: () => void;
  onClose: () => void;
  /** The pointer left / came back: the owner closes after a short grace. */
  onLeave?: () => void;
  onHold?: () => void;
}

export function useSeasons(title: Title, enabled: boolean): number | null {
  const { data } = useQuery(enabled && title.kind === 'series' ? `eps:${title.id}` : null, () => getEpisodes(title.id));
  return data && data.length ? seasonsOf(data).length : null;
}

/** Netflix-style expanded card, floated over the row on desktop. */
/** The trailer, muted, over the still once the card has been open a moment; it unmounts with the card. */
function HoverTrailer({ title }: { title: Title }) {
  const id = youtubeId(title.trailer);
  const enabled = useLibrary((s) => s.settings.previewAutoplay);
  const reducedMotion = useReducedMotion();
  const canHover = useCanHover();
  const [openMs, setOpenMs] = useState(0);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!id) return;
    const t = window.setTimeout(() => setOpenMs(HOVER_TRAILER_MS), HOVER_TRAILER_MS);
    return () => window.clearTimeout(t);
  }, [id]);
  if (!id || !shouldPreviewTrailer({ trailerId: id, enabled, reducedMotion, saveData: saveData(), canHover, openMs })) return null;
  return (
    <span className={`hover-card__trailer ${shown ? 'hover-card__trailer--on' : ''}`} aria-hidden="true">
      <iframe
        src={trailerSrc(id, window.location.origin)}
        title=""
        tabIndex={-1}
        allow="autoplay; encrypted-media"
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={() => setShown(true)}
      />
    </span>
  );
}

export function HoverCard({ title, anchor, progress, label, onPlay, onClose, onLeave, onHold }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const { openInfo } = useTitleActions();
  const seasons = useSeasons(title, true);
  const [shown, setShown] = useState(false);

  const width = anchor.width * SCALE;
  const vw = document.documentElement.clientWidth;
  const idealLeft = anchor.left + anchor.width / 2 - width / 2;
  const left = Math.min(Math.max(MARGIN, idealLeft), vw - width - MARGIN);
  const top = anchor.top + window.scrollY - (anchor.height * SCALE - anchor.height) / 2;
  const originX = ((anchor.left + anchor.width / 2 - left) / width) * 100;

  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const onScroll = (e: Event) => {
      if (e.target !== document) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const length = title.kind === 'series' ? (seasons ? seasonsLabel(seasons) : 'Series') : runtime(title.duration);

  return createPortal(
    <div
      ref={ref}
      className={`hover-card ${shown ? 'hover-card--shown' : ''}`}
      style={{ left, top, width, transformOrigin: `${originX}% 30%` }}
      onMouseEnter={onHold}
      onMouseLeave={onLeave ?? onClose}
      role="dialog"
      aria-label={title.enTitle}
    >
      <button type="button" className="hover-card__art" onClick={() => openInfo(title)} tabIndex={-1} aria-hidden="true">
        <BoxArt title={title} eager />
        <HoverTrailer title={title} />
        {progress !== undefined && progress > 0 && (
          <span className="progress progress--card">
            <span style={{ width: `${Math.min(100, progress * 100)}%` }} />
          </span>
        )}
      </button>
      <div className="hover-card__body">
        <div className="hover-card__actions">
          <button type="button" className="icon-btn icon-btn--round icon-btn--primary" aria-label="Play" onClick={onPlay}>
            <PlayIcon size={20} />
          </button>
          <ListButton title={title} size="sm" />
          <RateButton title={title} size="sm" />
          <button
            type="button"
            className="icon-btn icon-btn--round hover-card__more"
            aria-label="More info"
            title="Episodes & info"
            onClick={() => openInfo(title)}
          >
            <ChevronDownIcon size={20} />
          </button>
        </div>
        <div className="meta">
          <AgeBadge title={title} />
          {label && <span>{label}</span>}
          {length && <span>{length}</span>}
          <HdBadge />
        </div>
        {title.genres.length > 0 && (
          <ul className="genres" aria-label="Genres">
            {title.genres.slice(0, 3).map((g) => (
              <li key={g.en}>{g.en}</li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}
