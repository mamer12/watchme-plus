/** The loading number shown in the spinner while the video buffers. Pure. */

export const LOAD_PERCENT = {
  /** Seconds buffered ahead of the playhead that count as 100%. */
  TARGET_S: 6,
  /** Most points the number may rise per tick. */
  MAX_STEP: 8,
  TICK_MS: 250,
  /** Until the video reports "playing" the number stops here. */
  CAP: 99,
  /** Screen readers hear a new value every this many points. */
  ANNOUNCE_STEP: 10,
} as const;

interface Ranges {
  length: number;
  start(i: number): number;
  end(i: number): number;
}

/** Seconds buffered from `t` to the end of the range holding it (0 when none). */
export function bufferedAheadOf(ranges: Ranges, t: number): number {
  for (let i = 0; i < ranges.length; i++) {
    if (t >= ranges.start(i) - 0.05 && t <= ranges.end(i)) return Math.max(0, ranges.end(i) - t);
  }
  return 0;
}

/** The target is 6 s, or what is left of the video when less. */
export const targetSeconds = (remaining: number): number =>
  Number.isFinite(remaining) && remaining > 0 ? Math.min(LOAD_PERCENT.TARGET_S, remaining) : LOAD_PERCENT.TARGET_S;

/** Unsmoothed percent, 0..100. */
export function rawPercent(ahead: number, remaining: number): number {
  return Math.max(0, Math.min(100, Math.round((ahead / targetSeconds(remaining)) * 100)));
}

/**
 * The number to show next: never lower than before, rising by at most 8 points a tick, and at most 99 until the video
 * is playing. A new loading episode (new source, seek into unbuffered data, episode change) starts again from 0.
 */
export function nextPercent(prev: number, raw: number, playing: boolean): number {
  const eased = Math.min(raw, prev + LOAD_PERCENT.MAX_STEP);
  const capped = playing ? eased : Math.min(eased, LOAD_PERCENT.CAP);
  return Math.max(prev, capped);
}

/** The value read out by screen readers: every 10 points, so it does not chatter. */
export const announcedPercent = (p: number): number => Math.floor(p / LOAD_PERCENT.ANNOUNCE_STEP) * LOAD_PERCENT.ANNOUNCE_STEP;
