/** Automatic quality, Netflix style. Pure: the player feeds it measurements and obeys its answer (one step at a time). */

export const QC = {
  /** A level is affordable when throughput >= its bitrate x this. */
  SAFETY: 1.4,
  /** One step up needs this much buffered ahead ... */
  UP_AHEAD_S: 20,
  /** ... continuously for this long. */
  UP_HEALTHY_MS: 25_000,
  /** Buffered ahead below this and falling: step down before the buffer runs dry. */
  DOWN_AHEAD_S: 8,
  /** Throughput below current bitrate x this: step down. */
  DOWN_THROUGHPUT: 1.1,
  /** Below this a step down ignores the cooldown (a stall is close). */
  CRITICAL_AHEAD_S: 4,
  /** Minimum time between two switches. */
  COOLDOWN_MS: 15_000,
  /** After a swap that was abandoned: wait this x 2^(failures-1), up to MAX. */
  ABORT_BACKOFF_MS: 10_000,
  ABORT_BACKOFF_MAX_MS: 120_000,
  DEFAULT_CAP: 1080,
  EWMA_ALPHA: 0.3,
  /** "Falling": the buffer is this much lower than it was 3 s ago. */
  FALLING_DROP_S: 0.5,
  /** Some browsers keep only a few seconds ahead however fast the line is: a steady reading of at least this long and this much counts as healthy. */
  STEADY_MIN_S: 2,
  STEADY_SAMPLES: 5,
  STEADY_SPREAD_S: 1,
} as const;

/** Kill switch: false and quality only changes when the viewer picks one. */
export const AUTO_QUALITY = true;

/** Typical bytes/s for a file of this height when its size isn't known yet. */
export function estimateBytesPerSec(height: number): number {
  if (height >= 2160) return 2_200_000;
  if (height >= 1080) return 600_000;
  if (height >= 720) return 300_000;
  if (height >= 480) return 140_000;
  if (height >= 360) return 80_000;
  return 45_000;
}

export interface Level {
  height: number;
  /** The file's bitrate in bytes per second. */
  bytesPerSec: number;
}

/** Levels, lowest first, from each file's size (bytes) and the title's duration (s); unknown sizes use the estimate. */
export function buildLevels(files: { height: number; url: string }[], sizes: ReadonlyMap<string, number>, duration: number): Level[] {
  return [...files]
    .sort((a, b) => a.height - b.height)
    .map((f) => {
      const size = sizes.get(f.url);
      const real = size && duration > 0 && Number.isFinite(duration) ? size / duration : 0;
      return { height: f.height, bytesPerSec: real > 0 ? real : estimateBytesPerSec(f.height) };
    });
}

export interface QcState {
  lastSwitch: number;
  /** No change before this time (an abandoned swap backs off). */
  blockedUntil: number;
  failures: number;
  healthySince: number | null;
  /** Buffered-ahead readings, one per second, newest last. */
  history: number[];
}

export const qcStart = (now: number): QcState => ({ lastSwitch: now, blockedUntil: 0, failures: 0, healthySince: null, history: [] });

/** A swap finished: the cooldown starts and the failures are forgotten. */
export const qcSwitched = (s: QcState, now: number): QcState => ({ ...s, lastSwitch: now, failures: 0, healthySince: null });

/** A swap was abandoned: back off (10 s, 20 s, 40 s ... up to 2 min) so it never retries in a storm. */
export function qcAborted(s: QcState, now: number): QcState {
  const failures = s.failures + 1;
  const wait = Math.min(QC.ABORT_BACKOFF_MAX_MS, QC.ABORT_BACKOFF_MS * 2 ** (failures - 1));
  return { ...s, failures, blockedUntil: now + wait, healthySince: null };
}

export interface QcInput {
  now: number;
  levels: readonly Level[];
  currentHeight: number;
  /** Highest height auto may pick. */
  cap: number;
  /** Bytes per second, null when not measured yet. */
  throughput: number | null;
  /** Seconds buffered ahead of the playhead. */
  ahead: number;
  playing: boolean;
  /** False once the viewer picked a fixed quality. */
  auto: boolean;
}

export type QcReason = 'cap' | 'buffer' | 'throughput' | 'up';
export interface QcResult {
  state: QcState;
  /** Height to move to (always one step from the current one), or null to stay. */
  target: number | null;
  reason: QcReason | null;
}

const pushAhead = (h: readonly number[], ahead: number): number[] => [...h, ahead].slice(-8);

/**
 * Decides the next quality. Down is quick (a thin and falling buffer, or throughput close to the current bitrate);
 * up is slow (a healthy buffer for 25 s, and the next level affordable with the 1.4 safety margin). One step at a
 * time, never above the cap, 15 s between switches.
 */
export function qcDecide(s: QcState, i: QcInput): QcResult {
  const idle = (state: QcState): QcResult => ({ state, target: null, reason: null });
  if (!AUTO_QUALITY || !i.auto || !i.levels.length) return idle({ ...s, healthySince: null, history: pushAhead(s.history, i.ahead) });
  let idx = i.levels.findIndex((l) => l.height === i.currentHeight);
  if (idx < 0) idx = Math.max(0, i.levels.filter((l) => l.height < i.currentHeight).length - 1);
  const cur = i.levels[idx]!;
  let capIdx = -1;
  i.levels.forEach((l, n) => {
    if (l.height <= i.cap) capIdx = n;
  });
  capIdx = Math.max(0, capIdx);

  const history = pushAhead(s.history, i.ahead);
  const falling = s.history.length >= 3 && i.ahead <= s.history[s.history.length - 3]! - QC.FALLING_DROP_S;
  const recent = history.slice(-QC.STEADY_SAMPLES);
  const steady = recent.length >= QC.STEADY_SAMPLES && Math.min(...recent) >= QC.STEADY_MIN_S && Math.max(...recent) - Math.min(...recent) < QC.STEADY_SPREAD_S;
  const healthyNow = i.playing && (i.ahead >= QC.UP_AHEAD_S || steady);
  const next: QcState = { ...s, history, healthySince: healthyNow ? s.healthySince ?? i.now : null };
  const unblocked = i.now >= s.blockedUntil;
  const cooled = i.now - s.lastSwitch >= QC.COOLDOWN_MS;
  const down = (reason: QcReason): QcResult => ({ state: { ...next, healthySince: null }, target: i.levels[idx - 1]!.height, reason });

  if (!unblocked) return idle(next);
  if (idx > 0) {
    if (idx > capIdx && cooled) return down('cap');
    const thin = i.playing && i.ahead < QC.DOWN_AHEAD_S && falling;
    const slow = i.playing && i.throughput !== null && i.throughput < cur.bytesPerSec * QC.DOWN_THROUGHPUT && i.ahead < QC.UP_AHEAD_S;
    if ((thin || slow) && (cooled || i.ahead < QC.CRITICAL_AHEAD_S)) return down(thin ? 'buffer' : 'throughput');
  }
  if (idx < capIdx && cooled && next.healthySince !== null && i.now - next.healthySince >= QC.UP_HEALTHY_MS) {
    const up = i.levels[idx + 1]!;
    if (i.throughput !== null && i.throughput >= up.bytesPerSec * QC.SAFETY) {
      return { state: { ...next, healthySince: null }, target: up.height, reason: 'up' };
    }
  }
  return idle(next);
}

// ---- throughput -----------------------------------------------------------------------------------------------

/** Exponentially weighted moving average of bytes per second. */
export interface Throughput {
  /** A measurement: `bytes` arrived in `ms`. */
  sample(bytes: number, ms: number): void;
  /**
   * A rate that can only be too LOW (a response read slowly because the player stopped pulling): it may raise the
   * estimate, never lower it.
   */
  floor(bytesPerSec: number): void;
  get(): number | null;
  reset(): void;
}

export function createThroughput(alpha: number = QC.EWMA_ALPHA): Throughput {
  let value: number | null = null;
  const blend = (v: number) => {
    value = value === null ? v : value + alpha * (v - value);
  };
  return {
    sample(bytes, ms) {
      if (bytes < 0 || !(ms > 0)) return;
      blend((bytes / ms) * 1000);
    },
    floor(bps) {
      if (bps > 0 && (value === null || bps > value)) blend(bps);
    },
    get: () => value,
    reset() {
      value = null;
    },
  };
}

export interface BufferMark {
  /** End of the buffered range holding the playhead (s). */
  end: number;
  at: number;
}

/**
 * Bytes that arrived between two marks, from how much the buffer grew at the file's bitrate. Null when it says nothing:
 * the buffer is full (the browser stopped downloading), the playhead jumped to another range, or no time passed.
 */
export function bufferGrowthSample(prev: BufferMark | null, cur: BufferMark, bytesPerSec: number, ahead: number): { bytes: number; ms: number } | null {
  if (!prev) return null;
  const ms = cur.at - prev.at;
  if (!(ms > 0)) return null;
  const grown = cur.end - prev.end;
  if (grown < 0) return null;
  if (grown === 0 && ahead >= QC.UP_AHEAD_S + 5) return null;
  if (grown > (ms / 1000) * 30) return null;
  return { bytes: grown * bytesPerSec, ms };
}
