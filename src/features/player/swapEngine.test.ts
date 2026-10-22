import { describe, expect, it } from 'vitest';
import { createSwapEngine, type SwapDeps, type VidLike } from './swapEngine';

/** A video that plays in simulated time and buffers `bufferTo` seconds once loaded. */
class FakeVideo implements VidLike {
  currentTime = 0;
  paused = true;
  seeking = false;
  readyState = 0;
  duration = 600;
  playbackRate = 1;
  loaded = false;
  bufferEnd = 0;
  plays = 0;
  private handlers = new Map<string, Set<() => void>>();
  get buffered() {
    const end = this.bufferEnd;
    return { length: end > 0 ? 1 : 0, start: () => 0, end: () => end };
  }
  play() {
    this.paused = false;
    this.plays += 1;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  addEventListener(t: string, fn: () => void) {
    (this.handlers.get(t) ?? this.handlers.set(t, new Set()).get(t)!).add(fn);
  }
  removeEventListener(t: string, fn: () => void) {
    this.handlers.get(t)?.delete(fn);
  }
  tick(dt: number) {
    if (!this.paused && this.readyState >= 3) this.currentTime += dt * this.playbackRate;
  }
}

function setup(opts: { mainPaused?: boolean; standbyBuffer?: number; blocked?: boolean } = {}) {
  const main = new FakeVideo();
  main.readyState = 4;
  main.paused = opts.mainPaused ?? false;
  main.currentTime = 100;
  main.bufferEnd = 200;
  const standby = new FakeVideo();
  let clock = 0;
  const log: string[] = [];
  const deps: SwapDeps = {
    main: () => main,
    standby: () => standby,
    load: () => {
      log.push('load');
      standby.loaded = true;
      standby.readyState = 1;
    },
    release: () => {
      log.push('release');
      standby.loaded = false;
      standby.readyState = 0;
      standby.bufferEnd = 0;
    },
    commit: () => log.push('commit'),
    speed: () => 1,
    blocked: () => opts.blocked ?? false,
    now: () => clock,
    frame: () => () => {},
    every: () => () => {},
  };
  const engine = createSwapEngine(deps);
  /** Advances 50 ms; the standby buffers up to `ahead` seconds past its position once it has metadata. */
  const advance = (dt = 0.05) => {
    clock += dt * 1000;
    main.tick(dt);
    standby.tick(dt);
    if (standby.loaded) {
      standby.readyState = standby.readyState >= 3 ? 3 : 3;
      standby.bufferEnd = Math.max(standby.bufferEnd, Math.min(600, standby.currentTime + (opts.standbyBuffer ?? 8)));
      if (standby.bufferEnd < standby.currentTime) standby.bufferEnd = standby.currentTime + 8;
    }
    engine.step();
  };
  return { main, standby, engine, advance, log, now: () => clock };
}

describe('swap engine', () => {
  it('PERF-014: prepares, parks ahead of the playhead, starts just before it arrives, then swaps within 120 ms', async () => {
    const t = setup();
    const out = t.engine.swapTo(720, 'u');
    for (let i = 0; i < 400 && t.engine.busy(); i++) t.advance();
    expect(await out).toBe('swapped');
    expect(t.log).toEqual(['load', 'commit']);
    expect(Math.abs(t.engine.stats().lastDrift!)).toBeLessThanOrEqual(0.12);
    expect(t.standby.plays).toBe(1);
    // The main video was never touched.
    expect(t.main.paused).toBe(false);
    expect(t.main.plays).toBe(0);
    expect(t.main.playbackRate).toBe(1);
  });

  it('PERF-014: gives up silently and empties the second video when it never gets ready', async () => {
    const t = setup({ standbyBuffer: 1 });
    const out = t.engine.swapTo(720, 'u');
    for (let i = 0; i < 400 && t.engine.busy(); i++) t.advance(0.1);
    expect(await out).toBe('timeout');
    expect(t.log).toEqual(['load', 'release']);
    expect(t.engine.busy()).toBe(false);
  });

  it('PERF-015: a seek of the main video cancels the swap and releases the second one', async () => {
    const t = setup();
    const out = t.engine.swapTo(720, 'u');
    for (let i = 0; i < 5; i++) t.advance();
    t.engine.notify('seeking');
    expect(await out).toBe('seek');
    expect(t.log).toEqual(['load', 'release']);
  });

  it('PERF-015: a new episode cancels the swap', async () => {
    const t = setup();
    const out = t.engine.swapTo(720, 'u');
    t.advance();
    t.engine.notify('episode');
    expect(await out).toBe('episode');
  });

  it('PERF-015: while paused it prepares, holds, and swaps only after play', async () => {
    const t = setup({ mainPaused: true });
    const out = t.engine.swapTo(720, 'u');
    for (let i = 0; i < 200; i++) t.advance();
    expect(t.engine.state().phase).toBe('ready');
    expect(t.log).toEqual(['load']);
    t.main.paused = false;
    t.engine.notify('play');
    for (let i = 0; i < 400 && t.engine.busy(); i++) t.advance();
    expect(await out).toBe('swapped');
    expect(t.log).toEqual(['load', 'commit']);
  });

  it('PERF-015: does not start while picture in picture holds the main element, and runs one swap at a time', async () => {
    const blocked = setup({ blocked: true });
    expect(await blocked.engine.swapTo(720, 'u')).toBe('cancelled');
    const t = setup();
    void t.engine.swapTo(720, 'u');
    expect(await t.engine.swapTo(1080, 'v')).toBe('cancelled');
    t.engine.cancel();
  });
});
