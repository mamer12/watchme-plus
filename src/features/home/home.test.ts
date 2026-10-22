import { describe, expect, it } from 'vitest';
import { parseTitle } from '../../api/parse';
import { initialState, recordProgress, setRating } from '../../state/library';
import { canPreview } from './preview';
import { becauseSources } from './sources';

const env = { desktop: true, canHover: true, saveData: false, reducedMotion: false, enabled: true };

describe('home', () => {
  it('HOME-002: autoplays the billboard preview only on desktop, never with data saver or reduced motion', () => {
    expect(canPreview(env)).toBe(true);
    expect(canPreview({ ...env, desktop: false })).toBe(false);
    expect(canPreview({ ...env, canHover: false })).toBe(false);
    expect(canPreview({ ...env, saveData: true })).toBe(false);
    expect(canPreview({ ...env, reducedMotion: true })).toBe(false);
  });

  it('SET-003: the preview autoplay setting turns previews off', () => {
    expect(canPreview({ ...env, enabled: false })).toBe(false);
  });

  it('HOME-006: "Because You…" rows: loved titles first, then the latest watched, then likes', () => {
    const a = parseTitle({ nb: '1', en_title: 'A', imdbUrlRef: 'tt0000001' })!;
    const b = parseTitle({ nb: '2', en_title: 'B', imdbUrlRef: 'tt0000002' })!;
    const c = parseTitle({ nb: '3', en_title: 'C', imdbUrlRef: null })!;
    const d = parseTitle({ nb: '4', en_title: 'D', imdbUrlRef: 'tt0000004' })!;
    let s = recordProgress(initialState(), { video: a, series: null, position: 60, duration: 600, next: null, now: 1 });
    s = recordProgress(s, { video: c, series: null, position: 60, duration: 600, next: null, now: 2 });
    const ids = (st: typeof s, n?: number) => becauseSources(st, null, n).map((x) => `${x.snap.id}:${x.reason}`);
    expect(ids(s)).toEqual(['1:watched']);
    s = setRating(s, d, 'like');
    expect(ids(s)).toEqual(['1:watched', '4:liked']);
    s = recordProgress(s, { video: b, series: null, position: 60, duration: 600, next: null, now: 3 });
    expect(ids(s, 2)).toEqual(['2:watched', '1:watched']);
    expect(ids(setRating(s, b, 'dislike'))).toEqual(['1:watched', '4:liked']);
    expect(ids(setRating(s, d, 'love'))).toEqual(['4:loved', '2:watched', '1:watched']);
  });
});
