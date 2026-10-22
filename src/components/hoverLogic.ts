/** Hover-card timing and the trailer decision. Pure. */
/** The card opens after the pointer rests this long on a tile. */
export const HOVER_OPEN_MS = 400;
/** The trailer starts this long after the card opens (about a second of hovering in all). */
export const HOVER_TRAILER_MS = 600;
/** A pointer that slips off the card for less than this does not close it (jitter at the edge). */
export const HOVER_CLOSE_GRACE_MS = 180;

export interface HoverTrailerOptions {
  trailerId: string | null;
  /** The "Autoplay previews" setting. */
  enabled: boolean;
  reducedMotion: boolean;
  saveData: boolean;
  /** A mouse that can hover (never touch-only). */
  canHover: boolean;
  /** Time the card has been open. */
  openMs: number;
}

/** The provider (mirror choice) is deliberately absent: trailers come from YouTube, not the mirror. */
export function shouldPreviewTrailer(o: HoverTrailerOptions): boolean {
  if (!o.trailerId || !o.enabled || o.reducedMotion || o.saveData || !o.canHover) return false;
  return o.openMs >= HOVER_TRAILER_MS;
}

/** Whether a pointer that left the card (or tile) at `leftAt` should now close it. */
export function shouldCloseHover(leftAt: number | null, now: number): boolean {
  return leftAt !== null && now - leftAt >= HOVER_CLOSE_GRACE_MS;
}
