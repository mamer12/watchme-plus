import { describe, expect, it } from 'vitest';
import { pickNext, type Box } from './spatialNav';

const box = (left: number, top: number, w = 100, h = 60): Box => ({ left, top, right: left + w, bottom: top + h });

describe('spatial navigation', () => {
  it('NAV-003: arrow keys move to the nearest element in that direction, staying on the row', () => {
    const from = box(100, 100);
    const row = [box(210, 100), box(320, 100), box(210, 300), box(0, 100), box(100, 220), box(100, 0)];
    expect(pickNext(from, row, 'right')).toBe(0);
    expect(pickNext(from, row, 'left')).toBe(3);
    expect(pickNext(from, row, 'down')).toBe(4);
    expect(pickNext(from, row, 'up')).toBe(5);
    expect(pickNext(from, [box(0, 100)], 'right')).toBe(-1);
  });
});
