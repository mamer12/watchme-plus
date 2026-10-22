/** Seamless quality swap: the pure parts (timing math and the state machine). The DOM side is in features/player. */

export const SWAP = {
  /** How far ahead of the playhead the second video is parked. */
  LEAD_S: 2.5,
  MIN_LEAD_S: 2,
  MAX_LEAD_S: 5,
  /** The second video must hold this much buffered ahead of its parking spot ... */
  READY_AHEAD_S: 4,
  /** ... or this much when the browser says HAVE_ENOUGH_DATA and will not buffer more while paused. */
  READY_AHEAD_ENOUGH_S: 2,
  /** Longest to wait for the file's metadata (MP4s with the index at the end take a few seconds). */
  LOAD_TIMEOUT_MS: 15_000,
  /** Preparing (buffering) from the moment the metadata is in. */
  PREPARE_TIMEOUT_MS: 12_000,
  ALIGN_TIMEOUT_MS: 6_000,
  /** Both videos closer than this: swap. */
  DRIFT_OK_S: 0.12,
  /** Further apart than this: seek the second video again instead of nudging. */
  DRIFT_RESYNC_S: 0.4,
  NUDGE: 0.02,
  /** First guess for how long play() takes to show frames. */
  START_LATENCY_S: 0.1,
} as const;

/** The parking spot: where the main video will be in `lead` seconds (never past the last second). */
export function alignedTime(mainTime: number, lead: number, duration: number): number {
  const t = mainTime + lead;
  return Number.isFinite(duration) && duration > 0 ? Math.max(0, Math.min(t, duration - 1)) : t;
}

/** Longer seeks need a longer lead: 1.5 s plus twice the measured seek time, within 2 to 5 s. */
export function leadFor(seekLatencyMs: number | null): number {
  if (seekLatencyMs === null || !Number.isFinite(seekLatencyMs)) return SWAP.LEAD_S;
  return Math.min(SWAP.MAX_LEAD_S, Math.max(SWAP.MIN_LEAD_S, 1.5 + (2 * seekLatencyMs) / 1000));
}

/** Positive when the second video is ahead of the main one. */
export const driftSeconds = (mainTime: number, standbyTime: number): number => standbyTime - mainTime;

/** Start the parked video this long before the main one reaches the parking spot, so both show the same frame. */
export const shouldStartStandby = (mainTime: number, parkedAt: number, startLatency: number): boolean => mainTime >= parkedAt - startLatency;

export type DriftAction = { kind: 'swap' } | { kind: 'nudge'; rate: number } | { kind: 'resync' };

/**
 * What to do about the drift between the two videos. Within 120 ms: swap. A little further: play the second one 2%
 * slower (it is ahead) or faster (it is behind) for a moment. Far apart: seek it again.
 */
export function driftAction(drift: number, speed: number): DriftAction {
  const d = Math.abs(drift);
  if (d <= SWAP.DRIFT_OK_S) return { kind: 'swap' };
  if (d > SWAP.DRIFT_RESYNC_S) return { kind: 'resync' };
  return { kind: 'nudge', rate: speed * (drift > 0 ? 1 - SWAP.NUDGE : 1 + SWAP.NUDGE) };
}

// ---- state machine --------------------------------------------------------------------------------------------

export type SwapPhase = 'idle' | 'preparing' | 'ready' | 'aligning' | 'swapped' | 'aborted';
export type AbortReason = 'timeout' | 'seek' | 'episode' | 'error' | 'cancelled';

export interface SwapState {
  phase: SwapPhase;
  /** Height being swapped to. */
  target: number | null;
  startedAt: number;
  reason: AbortReason | null;
  /** The main video is paused: the second one is only prepared, the swap waits for play. */
  paused: boolean;
}

export const swapIdle = (): SwapState => ({ phase: 'idle', target: null, startedAt: 0, reason: null, paused: false });

export type SwapEvent =
  | { type: 'request'; height: number; now: number; paused: boolean }
  | { type: 'buffer'; ahead: number; readyState: number }
  | { type: 'tick'; now: number }
  | { type: 'pause' }
  | { type: 'play'; now: number }
  | { type: 'drift'; drift: number }
  | { type: 'seek' }
  | { type: 'episode' }
  | { type: 'error' }
  | { type: 'cancel' };

const abort = (s: SwapState, reason: AbortReason): SwapState => (s.phase === 'idle' || s.phase === 'swapped' || s.phase === 'aborted' ? s : { ...s, phase: 'aborted', reason });

/** Enough is buffered: 4 s with readyState >= 3, or 2 s when the browser has HAVE_ENOUGH_DATA (it won't buffer more while paused). */
export const isReady = (ahead: number, readyState: number): boolean =>
  (readyState >= 3 && ahead >= SWAP.READY_AHEAD_S) || (readyState >= 4 && ahead >= SWAP.READY_AHEAD_ENOUGH_S);

/** idle -> preparing -> ready -> aligning -> swapped, or aborted from anywhere before swapped. */
export function swapReduce(s: SwapState, e: SwapEvent): SwapState {
  switch (e.type) {
    case 'request':
      if (s.phase === 'preparing' || s.phase === 'ready' || s.phase === 'aligning') return s;
      return { phase: 'preparing', target: e.height, startedAt: e.now, reason: null, paused: e.paused };
    case 'buffer':
      if (s.phase !== 'preparing') return s;
      return isReady(e.ahead, e.readyState) ? { ...s, phase: 'ready' } : s;
    case 'tick':
      if (s.phase === 'preparing' && e.now - s.startedAt > SWAP.PREPARE_TIMEOUT_MS) return abort(s, 'timeout');
      if (s.phase === 'aligning' && e.now - s.startedAt > SWAP.ALIGN_TIMEOUT_MS) return abort(s, 'timeout');
      return s;
    case 'pause':
      // Aligning needs a moving playhead: go back to ready and wait for play.
      if (s.phase === 'aligning') return { ...s, phase: 'ready', paused: true };
      return s.phase === 'preparing' || s.phase === 'ready' ? { ...s, paused: true } : s;
    case 'play':
      if (s.phase === 'ready') return { ...s, phase: 'aligning', paused: false, startedAt: e.now };
      return s.phase === 'preparing' ? { ...s, paused: false } : s;
    case 'drift':
      return s.phase === 'aligning' && Math.abs(e.drift) <= SWAP.DRIFT_OK_S ? { ...s, phase: 'swapped' } : s;
    case 'seek':
      return abort(s, 'seek');
    case 'episode':
      return abort(s, 'episode');
    case 'error':
      return abort(s, 'error');
    case 'cancel':
      return abort(s, 'cancelled');
  }
}

/** A ready swap whose video is playing starts aligning at once; a paused one waits. */
export const startAligning = (s: SwapState, now: number): SwapState => (s.phase === 'ready' && !s.paused ? { ...s, phase: 'aligning', startedAt: now } : s);
