import { useRef, useState, type PointerEvent } from 'react';
import { clock } from '../../lib/format';

interface Props {
  time: number;
  duration: number;
  buffered: number;
  onSeek: (t: number) => void;
  onScrub: (scrubbing: boolean) => void;
}

/** Netflix's thin red bar with a red scrubber dot; grows on hover and shows the time under the pointer. */
export function ProgressBar({ time, duration, buffered, onSeek, onScrub }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const safe = duration > 0 ? duration : 0;
  const shown = drag ?? time;
  const pct = (t: number) => (safe ? Math.min(100, Math.max(0, (t / safe) * 100)) : 0);

  const timeAt = (clientX: number) => {
    const el = track.current;
    if (!el || !safe) return 0;
    const r = el.getBoundingClientRect();
    const rtl = getComputedStyle(el).direction === 'rtl';
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return (rtl ? 1 - f : f) * safe;
  };

  const down = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(timeAt(e.clientX));
    onScrub(true);
  };
  const move = (e: PointerEvent) => {
    const t = timeAt(e.clientX);
    if (e.pointerType === 'mouse') setHover(t);
    if (drag !== null) setDrag(t);
  };
  const up = (e: PointerEvent) => {
    if (drag === null) return;
    onSeek(timeAt(e.clientX));
    setDrag(null);
    onScrub(false);
  };

  return (
    <div
      ref={track}
      className={`pbar ${drag !== null ? 'pbar--drag' : ''}`}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(safe)}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={`${clock(shown)} of ${clock(safe)}`}
      tabIndex={-1}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => {
        setDrag(null);
        onScrub(false);
      }}
      onPointerLeave={() => setHover(null)}
    >
      <div className="pbar__rail">
        <div className="pbar__buffer" style={{ width: `${pct(buffered)}%` }} />
        {hover !== null && <div className="pbar__hover" style={{ width: `${pct(hover)}%` }} />}
        <div className="pbar__fill" style={{ width: `${pct(shown)}%` }} />
        <div className="pbar__dot" style={{ insetInlineStart: `${pct(shown)}%` }} />
      </div>
      {(hover !== null || drag !== null) && (
        <div className="pbar__tip" style={{ insetInlineStart: `${pct(drag ?? hover ?? 0)}%` }}>
          {clock(drag ?? hover ?? 0)}
        </div>
      )}
    </div>
  );
}
