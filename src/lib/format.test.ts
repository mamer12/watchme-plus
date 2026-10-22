import { describe, expect, it } from 'vitest';
import { clock, displayTitle, episodeLabel, minutesLeft, runtime, seasonsLabel, youtubeId } from './format';

describe('format', () => {
  it('TITLE-006: extracts the YouTube id for the privacy-enhanced embed', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=7YpuMymmiJ8')).toBe('7YpuMymmiJ8');
    expect(youtubeId('https://youtu.be/7YpuMymmiJ8?t=3')).toBe('7YpuMymmiJ8');
    expect(youtubeId('https://www.youtube.com/watch?feature=x&v=V-pndoeDuKA')).toBe('V-pndoeDuKA');
    expect(youtubeId('not a link')).toBeNull();
    expect(youtubeId(null)).toBeNull();
  });

  it('SET-005: shows Arabic or English titles, falling back to the other', () => {
    expect(displayTitle({ enTitle: 'The Weight', arTitle: 'الحمل' }, 'ar')).toBe('الحمل');
    expect(displayTitle({ enTitle: 'The Weight', arTitle: '' }, 'ar')).toBe('The Weight');
    expect(displayTitle({ enTitle: '', arTitle: '' }, 'en')).toBe('Untitled');
  });

  it('TITLE-005: formats runtimes, clocks, seasons and episode labels', () => {
    expect(runtime(6781)).toBe('1h 53m');
    expect(runtime(2648)).toBe('44m');
    expect(runtime(null)).toBeNull();
    expect(clock(3723)).toBe('1:02:03');
    expect(clock(Number.NaN)).toBe('0:00');
    expect(minutesLeft(1800)).toBe('30m left');
    expect(seasonsLabel(1)).toBe('1 Season');
    expect(seasonsLabel(5)).toBe('5 Seasons');
    expect(episodeLabel(1, 3)).toBe('S1:E3');
    expect(episodeLabel(null, null)).toBeNull();
  });
});
