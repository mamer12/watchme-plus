/**
 * What the player does when the <video> reports an error, before the "Playback problem" screen. Pure: the page feeds it
 * the error and applies the step. The ladder is bounded per load (it can never loop) and starts over after 20 s of good playback.
 */

export const RECOVERY = {
  /** Wait before re-seating the same source, for the 1st and 2nd time. */
  BACKOFF_MS: [1000, 3000],
  /** Seconds of uninterrupted playback after which the counters start over. */
  GOOD_PLAY_MS: 20_000,
  MAX_LOWER_STEPS: 2,
  /** The same error is written to the console at most this often. */
  LOG_EVERY_MS: 10_000,
} as const;

export type ErrorKind = 'network' | 'decode' | 'unsupported' | 'aborted' | 'unknown';

/** MediaError.code: 1 aborted, 2 network, 3 decode, 4 source not supported. */
export function errorKind(code: number | null | undefined): ErrorKind {
  switch (code) {
    case 1:
      return 'aborted';
    case 2:
      return 'network';
    case 3:
      return 'decode';
    case 4:
      return 'unsupported';
    default:
      return 'unknown';
  }
}

export interface Ladder {
  reseats: number;
  plainTried: boolean;
  lowers: number;
  /** When the current stretch of good playback began (ms), or null. */
  goodSince: number | null;
}

export const newLadder = (): Ladder => ({ reseats: 0, plainTried: false, lowers: 0, goodSince: null });

export type Step =
  | { action: 'reseat'; delayMs: number }
  | { action: 'plain' }
  | { action: 'lower' }
  | { action: 'fail' };

export interface StepContext {
  kind: ErrorKind;
  /** The file is currently fetched through the parallel service worker path. */
  parallel: boolean;
  /** A lower quality file exists to step down to. */
  canLower: boolean;
}

/**
 * The next rung for this error. Network (and aborted/unknown) errors: re-seat the same source twice (1 s, 3 s), then the
 * plain path, then one quality lower, then fail. Decode errors: one re-seat, then lower. Unsupported source: plain path,
 * then lower. Every rung is used at most as often as its counter allows, so the ladder ends.
 */
export function nextStep(ladder: Ladder, ctx: StepContext): { step: Step; ladder: Ladder } {
  const { kind } = ctx;
  const maxReseats = kind === 'decode' ? 1 : kind === 'unsupported' ? 0 : RECOVERY.BACKOFF_MS.length;
  if (ladder.reseats < maxReseats) {
    const delayMs = RECOVERY.BACKOFF_MS[ladder.reseats] ?? RECOVERY.BACKOFF_MS[RECOVERY.BACKOFF_MS.length - 1]!;
    return { step: { action: 'reseat', delayMs }, ladder: { ...ladder, reseats: ladder.reseats + 1, goodSince: null } };
  }
  if (kind !== 'decode' && ctx.parallel && !ladder.plainTried) {
    return { step: { action: 'plain' }, ladder: { ...ladder, plainTried: true, goodSince: null } };
  }
  if (ctx.canLower && ladder.lowers < RECOVERY.MAX_LOWER_STEPS) {
    return { step: { action: 'lower' }, ladder: { ...ladder, lowers: ladder.lowers + 1, goodSince: null } };
  }
  return { step: { action: 'fail' }, ladder };
}

/** Called while the video is really playing: after 20 s of it the counters start over. */
export function noteGoodPlay(ladder: Ladder, now: number): Ladder {
  if (ladder.goodSince === null) return { ...ladder, goodSince: now };
  if (now - ladder.goodSince >= RECOVERY.GOOD_PLAY_MS) return { ...newLadder(), goodSince: now };
  return ladder;
}

/** A stall, seek or error breaks the stretch of good playback. */
export const noteTrouble = (ladder: Ladder): Ladder => (ladder.goodSince === null ? ladder : { ...ladder, goodSince: null });

/**
 * Whether an error event is about what is on screen: it must come from the active element and from the source that
 * element holds now (the seamless swap swaps elements, and a reload leaves old errors queued).
 */
export function shouldHandleError(o: { fromActive: boolean; errorSrc: string | null | undefined; expectedSrc: string | null | undefined }): boolean {
  if (!o.fromActive || !o.expectedSrc) return false;
  const same = (a: string, b: string) => a === b || strip(a) === strip(b);
  return !o.errorSrc || same(o.errorSrc, o.expectedSrc);
}
const strip = (u: string): string => u.replace(/#.*$/, '');

/** Lets the same message through at most once per `everyMs`. */
export function createLogGate(everyMs: number = RECOVERY.LOG_EVERY_MS) {
  const last = new Map<string, number>();
  return (key: string, now: number): boolean => {
    const t = last.get(key);
    if (t !== undefined && now - t < everyMs) return false;
    last.set(key, now);
    return true;
  };
}
