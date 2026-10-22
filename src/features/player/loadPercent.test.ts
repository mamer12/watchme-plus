import { describe, expect, it } from 'vitest';
import { announcedPercent, bufferedAheadOf, nextPercent, rawPercent, targetSeconds } from './loadPercent';

const ranges = (...r: [number, number][]) => ({ length: r.length, start: (i: number) => r[i]![0], end: (i: number) => r[i]![1] });

describe('loading percent', () => {
  it('PLAYER-019: buffered ahead is measured to the end of the range holding the playhead', () => {
    expect(bufferedAheadOf(ranges([0, 10], [20, 30]), 4)).toBe(6);
    expect(bufferedAheadOf(ranges([0, 10], [20, 30]), 25)).toBe(5);
    expect(bufferedAheadOf(ranges([0, 10]), 15)).toBe(0);
    expect(bufferedAheadOf(ranges(), 0)).toBe(0);
  });

  it('PLAYER-019: 6 seconds ahead is 100%, or what remains when less than 6 s are left', () => {
    expect(rawPercent(3, 600)).toBe(50);
    expect(rawPercent(9, 600)).toBe(100);
    expect(targetSeconds(2)).toBe(2);
    expect(rawPercent(2, 2)).toBe(100);
  });

  it('PLAYER-019: rises by at most 8 points a tick, never falls, and stops at 99 until playing', () => {
    expect(nextPercent(0, 100, false)).toBe(8);
    expect(nextPercent(40, 10, false)).toBe(40);
    let p = 0;
    for (let i = 0; i < 30; i++) p = nextPercent(p, 100, false);
    expect(p).toBe(99);
    expect(nextPercent(99, 100, true)).toBe(100);
  });

  it('PLAYER-019: a new loading episode starts again from 0', () => {
    expect(nextPercent(0, 30, false)).toBe(8);
  });

  it('PLAYER-019: screen readers hear a new value every 10 points', () => {
    expect([0, 9, 10, 37, 99].map(announcedPercent)).toEqual([0, 0, 10, 30, 90]);
  });
});
