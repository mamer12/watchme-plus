import { memo, useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import type { Title } from '../api/types';
import { useCanHover, useIsDesktop } from '../hooks/useMedia';
import { useTitleActions } from '../hooks/useTitleActions';
import { displayTitle } from '../lib/format';
import { useLibrary } from '../state/store';
import { BoxArt } from './BoxArt';
import { HoverCard } from './HoverCard';
import { CloseIcon, InfoIcon, PlayIcon } from './Icons';

import { HOVER_CLOSE_GRACE_MS, HOVER_OPEN_MS } from './hoverLogic';

interface Props {
  title: Title;
  /** Continue Watching: what to play, how far along, "S1:E3" and a remove action. */
  videoId?: string;
  progress?: number;
  label?: string | null;
  /** Synced: the other device the position came from. */
  from?: string;
  onRemove?: () => void;
  /** Force the 16:9 art even on mobile (grids). */
  wide?: boolean;
}

function TitleCardImpl({ title, videoId, progress, label, from, onRemove, wide = false }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const canHover = useCanHover();
  const desktop = useIsDesktop();
  const lang = useLibrary((s) => s.settings.titleLang);
  const { openInfo, play } = useTitleActions();
  const isContinue = videoId !== undefined;
  const name = displayTitle(title, lang);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hold = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  // A pointer slipping off the tile or card for a moment doesn't close it.
  const leaveSoon = useCallback(() => {
    hold();
    closeTimer.current = setTimeout(() => setAnchor(null), HOVER_CLOSE_GRACE_MS);
  }, [hold]);
  useEffect(() => () => {
    clear();
    hold();
  }, [hold]);

  const onEnter = () => {
    if (!canHover || !desktop) return;
    clear();
    hold();
    if (anchor) return;
    timer.current = setTimeout(() => {
      if (ref.current) setAnchor(ref.current.getBoundingClientRect());
    }, HOVER_OPEN_MS);
  };
  const onLeave = (e: MouseEvent) => {
    clear();
    // Moving onto the floating card keeps it open; it closes itself on leave.
    const to = e.relatedTarget as Element | null;
    if (!to || !(to instanceof Element) || !to.closest('.hover-card')) leaveSoon();
  };
  const close = useCallback(() => setAnchor(null), []);
  const doPlay = useCallback(() => {
    setAnchor(null);
    play(title, videoId ? { videoId } : {});
  }, [play, title, videoId]);

  const onClick = (e: MouseEvent) => {
    e.preventDefault();
    clear();
    hold();
    setAnchor(null);
    if (isContinue) doPlay();
    else openInfo(title);
  };

  return (
    <div ref={ref} className="card" onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <a
        href={isContinue ? `/watch/${videoId}` : `/title/${title.id}`}
        className="card__link"
        onClick={onClick}
        aria-label={`${name}${label ? `, ${label}` : ''}${from ? `, continued from ${from}` : ''}`}
      >
        <BoxArt title={title} variant={desktop || wide ? 'wide' : 'poster'} />
        {from && <span className="card__from">Continued from {from}</span>}
        {isContinue && !desktop && (
          <span className="card__play" aria-hidden="true">
            <PlayIcon size={22} />
          </span>
        )}
        {progress !== undefined && (
          <span className="progress progress--card" aria-label={`${Math.round(progress * 100)}% watched`}>
            <span style={{ width: `${Math.min(100, Math.max(2, progress * 100))}%` }} />
          </span>
        )}
      </a>
      {isContinue && (
        <div className="card__footer">
          <span className="card__label">{label ?? ''}</span>
          <button type="button" className="icon-btn" aria-label={`More info about ${name}`} onClick={() => openInfo(title)}>
            <InfoIcon size={18} />
          </button>
          {onRemove && (
            <button type="button" className="icon-btn" aria-label={`Remove ${name} from Continue Watching`} onClick={onRemove}>
              <CloseIcon size={18} />
            </button>
          )}
        </div>
      )}
      {anchor && <HoverCard title={title} anchor={anchor} progress={progress} label={label} onPlay={doPlay} onClose={close} onLeave={leaveSoon} onHold={hold} />}
    </div>
  );
}

export const TitleCard = memo(TitleCardImpl);
