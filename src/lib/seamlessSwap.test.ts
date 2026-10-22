import { describe, expect, it } from 'vitest';
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
  type SwapState,
} from './seamlessSwap';

const requested = (paused = false): SwapState => swapReduce(swapIdle(), { type: 'request', height: 720, now: 1000, paused });

describe('swap state machine', () => {
  it('PERF-015: goes preparing -> ready -> aligning -> swapped', () => {
    let s = requested();
    expect(s.phase).toBe('preparing');
    s = swapReduce(s, { type: 'buffer', ahead: 3.9, readyState: 3 });
    expect(s.phase).toBe('preparing');
    s = swapReduce(s, { type: 'buffer', ahead: 4, readyState: 2 });
    expect(s.phase).toBe('preparing');
    s = swapReduce(s, { type: 'buffer', ahead: 2.5, readyState: 3 });
    expect(s.phase).toBe('preparing');
    s = swapReduce(s, { type: 'buffer', ahead: 1.9, readyState: 4 });
    expect(s.phase).toBe('preparing');
    s = swapReduce(s, { type: 'buffer', ahead: 4, readyState: 3 });
    expect(s.phase).toBe('ready');
    s = startAligning(s, 5000);
    expect(s.phase).toBe('aligning');
    s = swapReduce(s, { type: 'drift', drift: 0.3 });
    expect(s.phase).toBe('aligning');
    s = swapReduce(s, { type: 'drift', drift: -0.1 });
    expect(s.phase).toBe('swapped');
    expect(s.target).toBe(720);
  });

  it('PERF-015: aborts silently after 12 s of preparing, and after 6 s of aligning', () => {
    expect(swapReduce(requested(), { type: 'tick', now: 1000 + SWAP.PREPARE_TIMEOUT_MS }).phase).toBe('preparing');
    const t = swapReduce(requested(), { type: 'tick', now: 1001 + SWAP.PREPARE_TIMEOUT_MS });
    expect(t.phase).toBe('aborted');
    expect(t.reason).toBe('timeout');
    let s = swapReduce(requested(), { type: 'buffer', ahead: 9, readyState: 4 });
    s = startAligning(s, 5000);
    expect(swapReduce(s, { type: 'tick', now: 5000 + SWAP.ALIGN_TIMEOUT_MS }).phase).toBe('aligning');
    expect(swapReduce(s, { type: 'tick', now: 5001 + SWAP.ALIGN_TIMEOUT_MS }).phase).toBe('aborted');
  });

  it('PERF-015: a seek, an episode change, an error or a cancel abandons the swap with its reason', () => {
    for (const [type, reason] of [['seek', 'seek'], ['episode', 'episode'], ['error', 'error'], ['cancel', 'cancelled']] as const) {
      const s = swapReduce(swapReduce(requested(), { type: 'buffer', ahead: 9, readyState: 4 }), { type });
      expect(s.phase).toBe('aborted');
      expect(s.reason).toBe(reason);
    }
    const done = { ...requested(), phase: 'swapped' as const };
    expect(swapReduce(done, { type: 'seek' }).phase).toBe('swapped');
  });

  it('PERF-015: while paused it only prepares; the swap waits for play', () => {
    let s = requested(true);
    s = swapReduce(s, { type: 'buffer', ahead: 9, readyState: 4 });
    expect(s.phase).toBe('ready');
    expect(startAligning(s, 5000).phase).toBe('ready');
    s = swapReduce(s, { type: 'play', now: 7000 });
    expect(s.phase).toBe('aligning');
    expect(s.paused).toBe(false);
    // Pausing during alignment goes back to waiting.
    s = swapReduce(s, { type: 'pause' });
    expect(s.phase).toBe('ready');
    expect(s.paused).toBe(true);
  });

  it('PERF-015: one swap at a time', () => {
    const s = requested();
    expect(swapReduce(s, { type: 'request', height: 1080, now: 5, paused: false })).toBe(s);
  });
});

describe('drift correction', () => {
  it('PERF-016: parks the second video ahead of the playhead, never past the last second', () => {
    expect(alignedTime(60, 2.5, 3600)).toBe(62.5);
    expect(alignedTime(3599, 2.5, 3600)).toBe(3599);
    expect(alignedTime(10, 2.5, NaN)).toBe(12.5);
  });

  it('PERF-016: the lead grows with the measured seek latency, within 2 to 5 s', () => {
    expect(leadFor(null)).toBe(2.5);
    expect(leadFor(50)).toBe(2);
    expect(leadFor(500)).toBe(2.5);
    expect(leadFor(5000)).toBe(5);
  });

  it('PERF-016: starts the parked video slightly before the main one reaches the spot', () => {
    expect(shouldStartStandby(61.8, 62.5, 0.1)).toBe(false);
    expect(shouldStartStandby(62.4, 62.5, 0.1)).toBe(true);
    expect(shouldStartStandby(63, 62.5, 0.1)).toBe(true);
  });

  it('PERF-016: swaps within 120 ms, nudges the speed by 2% up to 400 ms, seeks again beyond', () => {
    expect(driftSeconds(10, 10.05)).toBeCloseTo(0.05);
    expect(driftAction(0.12, 1)).toEqual({ kind: 'swap' });
    expect(driftAction(-0.12, 1)).toEqual({ kind: 'swap' });
    expect(driftAction(0.2, 1)).toEqual({ kind: 'nudge', rate: 0.98 });
    expect(driftAction(-0.2, 1.25)).toEqual({ kind: 'nudge', rate: 1.25 * 1.02 });
    expect(driftAction(0.4, 1).kind).toBe('nudge');
    expect(driftAction(0.41, 1)).toEqual({ kind: 'resync' });
    expect(driftAction(-3, 1)).toEqual({ kind: 'resync' });
  });
});
