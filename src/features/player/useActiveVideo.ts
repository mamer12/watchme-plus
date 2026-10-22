import { useCallback, useMemo, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';

export type Slot = 'a' | 'b';
export type FsVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void; webkitDisplayingFullscreen?: boolean };

/**
 * The player keeps two <video> elements and shows one. `video` always points at the active one (read `.current` at
 * use time, never keep it), so the rest of the page talks to whichever element is on screen. The other element is the
 * standby the seamless swap prepares. Sources are set here, not through React, so React never fights the swap.
 */
export function useActiveVideo() {
  const a = useRef<FsVideo | null>(null);
  const b = useRef<FsVideo | null>(null);
  const activeRef = useRef<Slot>('a');
  const [active, setActive] = useState<Slot>('a');
  const urls = useRef<Record<Slot, string | null>>({ a: null, b: null });

  const el = useCallback((slot: Slot): FsVideo | null => (slot === 'a' ? a : b).current, []);
  const video = useMemo(() => ({ get current() { return (activeRef.current === 'a' ? a : b).current; } }) as RefObject<FsVideo>, []);
  const standby = useCallback((): FsVideo | null => el(activeRef.current === 'a' ? 'b' : 'a'), [el]);
  const isActive = useCallback((slot: Slot) => activeRef.current === slot, []);

  /** Points an element at a file (or empties it: the source is removed and the memory freed). */
  const load = useCallback(
    (slot: Slot, url: string | null) => {
      const v = el(slot);
      urls.current[slot] = url;
      if (!v) return;
      if (url) v.src = url;
      else {
        v.pause();
        v.removeAttribute('src');
        v.load();
      }
    },
    [el],
  );

  /** The address the active element holds. */
  const activeUrl = useCallback(() => urls.current[activeRef.current], []);

  /** Makes `slot` the visible one inside the current frame. */
  const activate = useCallback((slot: Slot) => {
    activeRef.current = slot;
    flushSync(() => setActive(slot));
  }, []);

  return { video, refs: { a, b }, active, activeRef, isActive, standby, standbySlot: () => (activeRef.current === 'a' ? 'b' : 'a') as Slot, load, activeUrl, urls, activate, el };
}
