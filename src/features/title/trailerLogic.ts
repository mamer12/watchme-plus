/** When the details hero may swap its photo for the trailer. Pure. */
export const TRAILER_DELAY_MS = 1800;

export interface TrailerOptions {
  /** YouTube id of the title's trailer, or null when it has none. */
  trailerId: string | null;
  /** The "Autoplay previews" setting. */
  enabled: boolean;
  reducedMotion: boolean;
  saveData: boolean;
  /** The hero photo has loaded. */
  imageLoaded: boolean;
  /** Time since the photo loaded. */
  elapsedMs: number;
  /** The player is opening (Play was pressed). */
  playing: boolean;
  /** The tab is in the background. */
  hidden: boolean;
}

export function shouldAutoplayTrailer(o: TrailerOptions): boolean {
  if (!o.trailerId || !o.enabled || o.reducedMotion || o.saveData) return false;
  if (o.playing || o.hidden) return false;
  return o.imageLoaded && o.elapsedMs >= TRAILER_DELAY_MS;
}

export function trailerSrc(id: string, origin: string): string {
  const q = new URLSearchParams({
    autoplay: '1',
    mute: '1',
    controls: '0',
    playsinline: '1',
    rel: '0',
    modestbranding: '1',
    loop: '1',
    playlist: id,
    enablejsapi: '1',
    iv_load_policy: '3',
    disablekb: '1',
    origin,
  });
  return `https://www.youtube-nocookie.com/embed/${id}?${q.toString()}`;
}

/** A YouTube IFrame API command, as the postMessage string. */
export const trailerCommand = (func: 'mute' | 'unMute' | 'pauseVideo' | 'playVideo'): string =>
  JSON.stringify({ event: 'command', func, args: '' });
