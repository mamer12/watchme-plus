import { describe, expect, it } from 'vitest';
import { initialState } from '../../state/library';
import { library } from './fixtures';
import { buildTasteSummary, capSummary, isWeekendEve, MAX_SUMMARY_BYTES, type TasteSummary } from './tasteSummary';

const thursdayNight = new Date(2026, 9, 22, 21, 0); // Thursday 22 Oct 2026, 21:00
const tuesdayNoon = new Date(2026, 9, 20, 12, 0);

describe('taste summary', () => {
  it('TONIGHT-001: summarises genres, recent, liked and disliked titles of the active profile', () => {
    const s = buildTasteSummary(library(), tuesdayNoon, 'en');
    expect(s.genres[0]?.g).toBe('comedy');
    expect(s.recent).toEqual(['Delta Show', 'Alpha']); // newest activity first, episodes count for their series
    expect(s.liked).toEqual(['Alpha', 'Bravo', 'Delta Show']); // loved, liked, then My List
    expect(s.disliked).toEqual(['Charlie']);
    expect(s.eras['2020s']).toBe(2);
    expect(s.lang).toBe('en');
    expect(s.genres.map((g) => g.g)).not.toContain('horror');
  });

  it('TONIGHT-002: stays under the size cap and carries no ids or emails', () => {
    const big = library();
    for (let i = 0; i < 80; i++) {
      big.snapshots[`x${i}`] = { ...big.snapshots.a!, id: `x${i}`, enTitle: `A very long title number ${i} that goes on and on` };
      big.ratings[`x${i}`] = 'like';
      big.progress[`x${i}`] = { id: `x${i}`, seriesId: null, season: null, episode: null, position: 1, duration: 10, completed: true, updatedAt: i };
    }
    const s = buildTasteSummary(big, tuesdayNoon);
    const json = JSON.stringify(s);
    expect(json.length).toBeLessThanOrEqual(MAX_SUMMARY_BYTES);
    expect(s.recent.length).toBeLessThanOrEqual(10);
    expect(s.liked.length).toBeLessThanOrEqual(10);
    expect(s.disliked.length).toBeLessThanOrEqual(5);
    expect(json).not.toMatch(/@|"id"|userId/);
    const tiny = capSummary({ ...s, recent: Array(10).fill('x'.repeat(40)), liked: Array(10).fill('y'.repeat(40)), disliked: [], genres: [] });
    expect(JSON.stringify(tiny).length).toBeLessThanOrEqual(MAX_SUMMARY_BYTES);
    expect(buildTasteSummary(initialState(), tuesdayNoon).recent).toEqual([]);
  });

  it('TONIGHT-003: flags Thursday evening as the start of the weekend', () => {
    expect(isWeekendEve(thursdayNight)).toBe(true);
    expect(isWeekendEve(new Date(2026, 9, 22, 9, 0))).toBe(false);
    expect(isWeekendEve(tuesdayNoon)).toBe(false);
    const ctx = buildTasteSummary(library(), thursdayNight).ctx;
    expect(ctx).toEqual({ weekday: 'thursday', hour: 21, isWeekendEve: true });
    const shape: TasteSummary['ctx'] = ctx;
    expect(shape.weekday).toBe('thursday');
  });
});
