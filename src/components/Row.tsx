import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from './Icons';

interface Props {
  title: string;
  children: ReactNode;
  variant?: 'default' | 'top10';
  id?: string;
}

/** A horizontal row: arrows on desktop, swipe with scroll-snap on touch. */
export function Row({ title, children, variant = 'default', id }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const x = Math.abs(el.scrollLeft);
    setEdges({ start: x <= 4, end: x >= max - 4 });
  }, []);

  useEffect(() => {
    measure();
    const el = track.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, children]);

  const page = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === 'rtl' ? -1 : 1;
    el.scrollBy({ left: dir * rtl * el.clientWidth * 0.92, behavior: 'smooth' });
  };

  const headingId = id ? `${id}-h` : undefined;
  return (
    <section className={`row row--${variant}`} aria-labelledby={headingId}>
      <h2 className="row__title" id={headingId}>
        {title}
      </h2>
      <div className="row__viewport">
        {!edges.start && (
          <button type="button" className="row__arrow row__arrow--prev" aria-label={`Previous ${title}`} tabIndex={-1} onClick={() => page(-1)}>
            <ChevronLeftIcon size={36} />
          </button>
        )}
        <div className="row-track" ref={track} onScroll={measure}>
          {children}
        </div>
        {!edges.end && (
          <button type="button" className="row__arrow row__arrow--next" aria-label={`More ${title}`} tabIndex={-1} onClick={() => page(1)}>
            <ChevronRightIcon size={36} />
          </button>
        )}
      </div>
    </section>
  );
}
