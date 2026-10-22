import { describe, expect, it } from 'vitest';
import {
  AUTO_QUALITY,
  QC,
  bufferGrowthSample,
  buildLevels,
  createThroughput,
  qcAborted,
  qcDecide,
  qcStart,
  qcSwitched,
  type Level,
  type QcInput,
  type QcState,
} from './qualityController';
import { autoLabel } from '../features/player/Panels';

// Bitrates in bytes/s: 240p 50k, 360p 100k, 480p 150k, 720p 300k, 1080p 600k.
const LEVELS: Level[] = [240, 360, 480, 720, 1080].map((height, i) => ({ height, bytesPerSec: [50_000, 100_000, 150_000, 300_000, 600_000][i]! }));
const base = (over: Partial<QcInput> = {}): QcInput => ({ now: 100_000, levels: LEVELS, currentHeight: 480, cap: 1080, throughput: 1_000_000, ahead: 10, playing: true, auto: true, ...over });
const settled = (over: Partial<QcState> = {}): QcState => ({ ...qcStart(0), history: [10, 10, 10], ...over });

describe('quality controller', () => {
  it('PERF-003: the kill switch is on by default', () => {
    expect(AUTO_QUALITY).toBe(true);
  });

  it('PERF-003: steps up one level after 25 s of at least 20 s buffered when throughput covers the next level x1.4', () => {
    let r = qcDecide(settled(), base({ ahead: 30 }));
    expect(r.target).toBeNull();
    expect(r.state.healthySince).toBe(100_000);
    r = qcDecide(r.state, base({ now: 100_000 + QC.UP_HEALTHY_MS - 1, ahead: 30 }));
    expect(r.target).toBeNull();
    r = qcDecide(r.state, base({ now: 100_000 + QC.UP_HEALTHY_MS, ahead: 30 }));
    expect(r.target).toBe(720);
    expect(r.reason).toBe('up');
  });

  it('PERF-003: never steps up without throughput, without safety margin, or with a thin buffer', () => {
    const healthy = settled({ healthySince: 0 });
    expect(qcDecide(healthy, base({ ahead: 30, throughput: null })).target).toBeNull();
    // 720p needs 300k x 1.4 = 420k.
    expect(qcDecide(healthy, base({ ahead: 30, throughput: 419_000 })).target).toBeNull();
    expect(qcDecide(healthy, base({ ahead: 30, throughput: 421_000 })).target).toBe(720);
    const thin = qcDecide(healthy, base({ ahead: 19 }));
    expect(thin.target).toBeNull();
    expect(thin.state.healthySince).toBeNull();
  });

  it('PERF-003: moves one step at a time, even when the line is far faster', () => {
    const r = qcDecide(settled({ healthySince: 0 }), base({ currentHeight: 240, ahead: 40, throughput: 50_000_000 }));
    expect(r.target).toBe(360);
  });

  it('PERF-003: steps down at once when the buffer is under 8 s and falling', () => {
    const r = qcDecide(settled({ history: [9, 9, 9] }), base({ now: 50_000, ahead: 7 }));
    expect(r.target).toBe(360);
    expect(r.reason).toBe('buffer');
    expect(qcDecide(settled({ history: [7.2, 7, 7] }), base({ now: 50_000, ahead: 7 })).target).toBeNull();
  });

  it('PERF-003: a steady few seconds (a browser that buffers little) is healthy for stepping up, and never "falling"', () => {
    const steadyState = settled({ history: [2.4, 2.6, 2.5, 2.4, 2.5] });
    const r = qcDecide(steadyState, base({ ahead: 2.5, throughput: 1_000_000 }));
    expect(r.state.healthySince).toBe(100_000);
    expect(r.target).toBeNull();
    const flicker = qcDecide(steadyState, base({ now: 50_000, ahead: 2.3 }));
    expect(flicker.target).toBeNull();
  });

  it('PERF-003: steps down when throughput is under the current bitrate x1.1', () => {
    expect(qcDecide(settled(), base({ throughput: 164_000 })).target).toBe(360);
    expect(qcDecide(settled(), base({ throughput: 166_000 })).target).toBeNull();
    // A full buffer means the browser stopped downloading: a low reading says nothing.
    expect(qcDecide(settled(), base({ throughput: 100_000, ahead: 40 })).target).toBeNull();
  });

  it('PERF-003: waits 15 s between switches, except for a buffer about to run dry', () => {
    const justSwitched = qcSwitched(settled({ history: [9, 9, 9] }), 95_000);
    expect(qcDecide(justSwitched, base({ now: 100_000, ahead: 7 })).target).toBeNull();
    expect(qcDecide(justSwitched, base({ now: 100_000, ahead: 3, throughput: 100_000 })).target).toBe(360);
    expect(qcDecide(justSwitched, base({ now: 95_000 + QC.COOLDOWN_MS, ahead: 7 })).target).toBe(360);
    const up = qcDecide({ ...justSwitched, healthySince: 0 }, base({ now: 100_000, ahead: 40 }));
    expect(up.target).toBeNull();
  });

  it('PERF-003: never above the cap, and steps down when the cap is lowered', () => {
    const healthy = settled({ healthySince: 0 });
    expect(qcDecide(healthy, base({ currentHeight: 720, cap: 720, ahead: 40 })).target).toBeNull();
    expect(qcDecide(healthy, base({ currentHeight: 480, cap: 720, ahead: 40 })).target).toBe(720);
    const lowered = qcDecide(settled(), base({ currentHeight: 1080, cap: 720 }));
    expect(lowered.target).toBe(720);
    expect(lowered.reason).toBe('cap');
  });

  it('PERF-003: does nothing at the lowest level going down, or when auto is off (a fixed quality)', () => {
    expect(qcDecide(settled(), base({ currentHeight: 240, throughput: 1_000, ahead: 1 })).target).toBeNull();
    const fixed = qcDecide(settled({ healthySince: 0 }), base({ auto: false, ahead: 40 }));
    expect(fixed.target).toBeNull();
    expect(fixed.state.healthySince).toBeNull();
    expect(qcDecide(settled(), base({ auto: false, currentHeight: 1080, cap: 240, throughput: 1 })).target).toBeNull();
  });

  it('PERF-003: an abandoned swap backs off 10 s, 20 s, 40 s ... and a finished one resets it', () => {
    let s = qcAborted(settled(), 1000);
    expect(s.blockedUntil).toBe(11_000);
    s = qcAborted(s, 11_000);
    expect(s.blockedUntil).toBe(31_000);
    for (let i = 0; i < 10; i++) s = qcAborted(s, 0);
    expect(s.blockedUntil).toBe(QC.ABORT_BACKOFF_MAX_MS);
    expect(qcDecide(qcAborted(settled({ history: [9, 9, 9] }), 99_000), base({ ahead: 1 })).target).toBeNull();
    expect(qcSwitched(s, 5).failures).toBe(0);
  });

  it('PERF-003: levels come from file size / duration, with an estimate for unknown sizes', () => {
    const files = [{ height: 480, url: 'a' }, { height: 240, url: 'b' }];
    const levels = buildLevels(files, new Map([['a', 1_500_000]]), 100);
    expect(levels.map((l) => l.height)).toEqual([240, 480]);
    expect(levels[1]!.bytesPerSec).toBe(15_000);
    expect(levels[0]!.bytesPerSec).toBeGreaterThan(0);
    expect(buildLevels(files, new Map([['a', 5]]), 0)[1]!.bytesPerSec).toBeGreaterThan(1000);
  });

  it('PERF-003: throughput is an EWMA; a floor only ever raises it; buffer growth gives samples', () => {
    const t = createThroughput(0.5);
    expect(t.get()).toBeNull();
    t.sample(1_000_000, 1000);
    expect(t.get()).toBe(1_000_000);
    t.sample(0, 1000);
    expect(t.get()).toBe(500_000);
    t.floor(100_000);
    expect(t.get()).toBe(500_000);
    t.floor(900_000);
    expect(t.get()).toBe(700_000);
    t.sample(5, 0);
    expect(t.get()).toBe(700_000);
    t.reset();
    expect(t.get()).toBeNull();

    const m0 = { end: 10, at: 0 };
    expect(bufferGrowthSample(null, m0, 100, 5)).toBeNull();
    expect(bufferGrowthSample(m0, { end: 14, at: 2000 }, 100_000, 5)).toEqual({ bytes: 400_000, ms: 2000 });
    expect(bufferGrowthSample(m0, { end: 10, at: 2000 }, 100_000, 5)).toEqual({ bytes: 0, ms: 2000 });
    expect(bufferGrowthSample(m0, { end: 10, at: 2000 }, 100_000, 40)).toBeNull();
    expect(bufferGrowthSample(m0, { end: 500, at: 2000 }, 100_000, 5)).toBeNull();
    expect(bufferGrowthSample(m0, { end: 5, at: 2000 }, 100_000, 5)).toBeNull();
  });
});

describe('quality menu', () => {
  it('PERF-017: the Auto entry shows the current level in parentheses', () => {
    const q = { resolution: '480p', height: 480, url: 'u' };
    expect(autoLabel(true, q)).toBe('Auto (480p)');
    expect(autoLabel(true, null)).toBe('Auto');
    expect(autoLabel(false, q)).toBe('Auto');
  });
});
