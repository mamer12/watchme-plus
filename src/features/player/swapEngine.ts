/**
 * The DOM side of the seamless swap: parks a second <video> on the other quality a little ahead of the playhead, starts
 * it just before the main one gets there, and when both show the same moment hands the screen and the sound over in a
 * single frame. Everything it touches is injected, so it runs under Node in the tests.
 */
import { bufferedAhead } from '../../lib/adaptiveQuality';
import {
  SWAP,
  alignedTime,
  driftAction,
  driftSeconds,
  leadFor,
  shouldStartStandby,
  startAligning,
  swapIdle,
  swapReduce,
  type AbortReason,
  type SwapEvent,
  type SwapPhase,
  type SwapState,
} from '../../lib/seamlessSwap';

export interface VidLike {
  currentTime: number;
  readonly paused: boolean;
  readonly seeking: boolean;
  readonly readyState: number;
  readonly duration: number;
  readonly buffered: { length: number; start(i: number): number; end(i: number): number };
  playbackRate: number;
  play(): Promise<void> | void;
  pause(): void;
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}

export interface SwapDeps {
  main(): VidLike | null;
  standby(): VidLike | null;
  /** Points the second video at the file. */
  load(url: string): void;
  /** Empties the second video (memory back). */
  release(): void;
  /** Swaps the roles: transfers volume, speed and the rest, shows the new one, empties the old one. Runs inside a frame. */
  commit(): void;
  /** The viewer's playback speed. */
  speed(): number;
  /** Something keeps the main element in place (picture in picture, iOS native fullscreen). */
  blocked(): boolean;
  now(): number;
  /** Calls back on the next animation frame; returns a canceller. */
  frame(cb: () => void): () => void;
  /** Calls back every `ms`; returns a canceller. */
  every(ms: number, cb: () => void): () => void;
}

export type SwapOutcome = 'swapped' | AbortReason;

export interface SwapStats {
  /** Seconds the two videos differed by at the moment of the swap. */
  lastDrift: number | null;
  lastOutcome: SwapOutcome | null;
  swaps: number;
}

type Stage = 'loading' | 'seeking' | 'parked' | 'started';

export function createSwapEngine(deps: SwapDeps) {
  let state: SwapState = swapIdle();
  let stage: Stage = 'loading';
  let parkTime = 0;
  let seekAt = 0;
  let seekLatencyMs: number | null = null;
  let startLatency: number = SWAP.START_LATENCY_S;
  let playedAt = 0;
  let requestedAt = 0;
  let cleanup: Array<() => void> = [];
  let done: ((o: SwapOutcome) => void) | null = null;
  const stats: SwapStats = { lastDrift: null, lastOutcome: null, swaps: 0 };

  const phase = (): SwapPhase => state.phase;
  const dispatch = (e: SwapEvent) => {
    state = swapReduce(state, e);
  };

  function finish(outcome: SwapOutcome): void {
    for (const c of cleanup.splice(0)) c();
    const v = deps.standby();
    if (outcome !== 'swapped') {
      try {
        v?.pause();
      } catch {
        /* the element is going away */
      }
      deps.release();
    }
    stats.lastOutcome = outcome;
    const d = done;
    done = null;
    d?.(outcome);
  }

  function abortNow(reason: AbortReason): void {
    if (state.phase === 'idle' || state.phase === 'swapped' || state.phase === 'aborted') return;
    dispatch({ type: reason === 'seek' ? 'seek' : reason === 'episode' ? 'episode' : reason === 'error' ? 'error' : 'cancel' });
    if (phase() === 'aborted') finish(state.reason ?? reason);
  }

  const park = (m: VidLike, v: VidLike, lead: number) => {
    parkTime = alignedTime(m.currentTime, lead, v.duration);
    v.currentTime = parkTime;
    seekAt = deps.now();
    stage = 'seeking';
  };

  function beginAlign(m: VidLike, v: VidLike): void {
    const lead = leadFor(seekLatencyMs);
    const t = alignedTime(m.currentTime, lead, v.duration);
    if (bufferedAhead(v.buffered, t) < 2) {
      // The main video outran what the second one has: back to preparing from the new spot.
      state = { ...state, phase: 'preparing' };
      park(m, v, lead);
      return;
    }
    parkTime = t;
    v.pause();
    v.currentTime = t;
    stage = 'seeking';
    seekAt = deps.now();
  }

  function step(): void {
    if (state.phase === 'idle' || state.phase === 'swapped' || state.phase === 'aborted') return;
    const m = deps.main();
    const v = deps.standby();
    if (!m || !v) return abortNow('error');
    if (stage !== 'loading') dispatch({ type: 'tick', now: deps.now() });
    // Parking again and again must end somewhere.
    if (phase() !== 'aborted' && deps.now() - requestedAt > SWAP.LOAD_TIMEOUT_MS + SWAP.PREPARE_TIMEOUT_MS + SWAP.ALIGN_TIMEOUT_MS) state = { ...state, phase: 'aborted', reason: 'timeout' };
    if (phase() === 'aborted') return finish(state.reason ?? 'timeout');

    if (phase() === 'preparing') {
      if (stage === 'loading' && v.readyState < 1 && deps.now() - requestedAt > SWAP.LOAD_TIMEOUT_MS) state = { ...state, phase: 'aborted', reason: 'timeout' };
      if (phase() === 'aborted') return finish('timeout');
      if (stage === 'loading' && v.readyState >= 1) {
        // The preparing clock starts when the metadata is in.
        state = { ...state, startedAt: deps.now() };
        park(m, v, leadFor(seekLatencyMs));
      }
      if (stage === 'seeking' && !v.seeking && v.readyState >= 2 && Math.abs(v.currentTime - parkTime) < 0.5) {
        if (seekLatencyMs === null) seekLatencyMs = deps.now() - seekAt;
        stage = 'parked';
      }
      if (stage === 'parked') {
        dispatch({ type: 'buffer', ahead: bufferedAhead(v.buffered, v.currentTime), readyState: v.readyState });
        if (phase() === 'ready') {
          if (m.paused) state = { ...state, paused: true };
          else state = startAligning({ ...state, paused: false }, deps.now());
          if (phase() === 'aligning') beginAlign(m, v);
        }
      }
      return;
    }
    if (phase() === 'ready') {
      // Held while the main video is paused: the swap waits for play.
      if (!m.paused && !m.seeking) {
        dispatch({ type: 'play', now: deps.now() });
        if (phase() === 'aligning') beginAlign(m, v);
      }
      return;
    }
    // aligning
    if (m.paused) {
      v.pause();
      stage = 'parked';
      dispatch({ type: 'pause' });
      return;
    }
    if (stage === 'seeking') {
      if (!v.seeking && v.readyState >= 3 && Math.abs(v.currentTime - parkTime) < 0.5) {
        seekLatencyMs = deps.now() - seekAt;
        stage = 'parked';
      } else return;
    }
    if (stage === 'parked') {
      if (m.currentTime > parkTime + 0.5) {
        // Missed the spot (the main video went past while the second one buffered): park again.
        state = { ...state, phase: 'preparing' };
        park(m, v, leadFor(seekLatencyMs));
        return;
      }
      if (!shouldStartStandby(m.currentTime, parkTime, startLatency)) return;
      v.playbackRate = deps.speed();
      void Promise.resolve(v.play()).catch(() => abortNow('error'));
      playedAt = deps.now();
      stage = 'started';
      return;
    }
    // started: compare the two playheads every frame.
    if (v.currentTime <= parkTime + 0.03) return;
    if (playedAt > 0) {
      // How long play() took to show frames: time since the call minus what the video has advanced.
      const waited = (deps.now() - playedAt) / 1000 - (v.currentTime - parkTime);
      if (waited > 0 && waited < 1) startLatency = startLatency * 0.5 + waited * 0.5;
      playedAt = -1;
    }
    const drift = driftSeconds(m.currentTime, v.currentTime);
    const action = driftAction(drift, deps.speed());
    if (action.kind === 'swap') {
      if (v.readyState < 3 || deps.blocked()) return;
      v.playbackRate = deps.speed();
      stats.lastDrift = drift;
      dispatch({ type: 'drift', drift });
      if (phase() !== 'swapped') return;
      deps.commit();
      stats.swaps += 1;
      finish('swapped');
    } else if (action.kind === 'nudge') {
      v.playbackRate = action.rate;
    } else {
      v.currentTime = m.currentTime + startLatency;
    }
  }

  /** Starts a swap; resolves with how it ended. One at a time: a second call while one runs resolves 'cancelled'. */
  function swapTo(height: number, url: string): Promise<SwapOutcome> {
    const m = deps.main();
    const v = deps.standby();
    if (!m || !v || state.phase === 'preparing' || state.phase === 'ready' || state.phase === 'aligning' || deps.blocked()) return Promise.resolve('cancelled');
    state = swapReduce(swapIdle(), { type: 'request', height, now: deps.now(), paused: m.paused });
    stage = 'loading';
    seekAt = 0;
    playedAt = 0;
    requestedAt = deps.now();
    const onError = () => abortNow('error');
    const onProgress = () => step();
    v.addEventListener('error', onError);
    for (const t of ['loadedmetadata', 'seeked', 'canplay', 'progress', 'playing']) v.addEventListener(t, onProgress);
    cleanup = [
      () => v.removeEventListener('error', onError),
      () => {
        for (const t of ['loadedmetadata', 'seeked', 'canplay', 'progress', 'playing']) v.removeEventListener(t, onProgress);
      },
      deps.every(200, step),
    ];
    let stopFrames = false;
    let cancelFrame: (() => void) | null = null;
    const loop = () => {
      if (stopFrames) return;
      if (state.phase === 'aligning') step();
      cancelFrame = deps.frame(loop);
    };
    cancelFrame = deps.frame(loop);
    cleanup.push(() => {
      stopFrames = true;
      cancelFrame?.();
    });
    deps.load(url);
    return new Promise<SwapOutcome>((resolve) => {
      done = resolve;
    });
  }

  return {
    swapTo,
    /** Abandons the swap in progress, if any. */
    cancel: (reason: AbortReason = 'cancelled') => abortNow(reason),
    /** The main video was sought, paused or played, or the episode changed. */
    notify(what: 'seeking' | 'pause' | 'play' | 'episode'): void {
      if (what === 'seeking') abortNow('seek');
      else if (what === 'episode') abortNow('episode');
      else if (what === 'pause') {
        if (state.phase === 'aligning' || state.phase === 'preparing' || state.phase === 'ready') {
          deps.standby()?.pause();
          if (stage === 'started') stage = 'parked';
          dispatch({ type: 'pause' });
        }
      } else step();
    },
    busy: () => state.phase === 'preparing' || state.phase === 'ready' || state.phase === 'aligning',
    state: () => state,
    stats: () => stats,
    /** For tests and the debug hook: run one check now. */
    step,
  };
}

export type SwapEngine = ReturnType<typeof createSwapEngine>;
