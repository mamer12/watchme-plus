import { describe, expect, it } from 'vitest';
import { parseTitle } from '../api/parse';
import type { Title } from '../api/types';
import { endpoints } from '../api/catalog';
import {
  clearHistory,
  completeOnboarding,
  continueWatching,
  excludedIds,
  hydrate,
  initialState,
  recordProgress,
  removeFromContinue,
  resumeFor,
  setRating,
  startPosition,
  toggleMyList,
  updateSettings,
} from './library';

const movie = parseTitle({ nb: '10', en_title: 'Movie', kind: '1', imdbUrlRef: 'tt0000010', categories: [{ en_title: 'Action' }] })!;
const ep = (nb: string, e: number): Title => parseTitle({ nb, en_title: 'Show', kind: '2', season: '1', episodeNummer: String(e) })!;
const series = ep('20', 1);
const ep2 = ep('21', 2);

describe('library state', () => {
  it('HOME-003: lists unfinished movies and the current episode of each series, newest first, with S:E', () => {
    let s = recordProgress(initialState(), { video: movie, series: null, position: 600, duration: 6000, next: null, now: 1 });
    s = recordProgress(s, { video: ep2, series, position: 300, duration: 2400, next: ep('22', 3), now: 2 });
    const items = continueWatching(s);
    expect(items.map((i) => i.videoId)).toEqual(['21', '10']);
    expect(items[0]).toMatchObject({ season: 1, episode: 2, fraction: 0.125 });
    expect(items[1]?.fraction).toBeCloseTo(0.1);
    expect(continueWatching(s, 'movie').map((i) => i.videoId)).toEqual(['10']);
    const removed = removeFromContinue(removeFromContinue(s, '20'), '10');
    expect(continueWatching(removed)).toEqual([]);
  });

  it('PLAYER-010: saves progress, resumes from it and moves to the next episode after the credits', () => {
    let s = recordProgress(initialState(), { video: series, series, position: 2, duration: 2400, next: ep2 });
    expect(Object.keys(s.progress)).toHaveLength(0);
    s = recordProgress(s, { video: series, series, position: 1200, duration: 2400, next: ep2 });
    expect(startPosition(s, '20')).toBe(1200);
    s = recordProgress(s, { video: series, series, position: 2390, duration: 2400, next: ep2 });
    expect(s.progress['20']?.completed).toBe(true);
    expect(startPosition(s, '20')).toBe(0);
    expect(continueWatching(s)[0]).toMatchObject({ videoId: '21', fraction: 0, season: 1, episode: 2 });
    // Finishing the last episode drops the series from Continue Watching.
    s = recordProgress(s, { video: ep2, series, position: 2399, duration: 2400, next: null });
    expect(continueWatching(s)).toEqual([]);
  });

  it('TITLE-002: Play resumes the right episode and knows the time left', () => {
    let s = recordProgress(initialState(), { video: ep2, series, position: 600, duration: 2400, next: null });
    expect(resumeFor(s, series)).toMatchObject({ videoId: '21', position: 600, season: 1, episode: 2, remaining: 1800 });
    s = recordProgress(s, { video: movie, series: null, position: 100, duration: 1000, next: null });
    expect(resumeFor(s, movie)).toMatchObject({ videoId: '10', position: 100, remaining: 900 });
    expect(resumeFor(initialState(), movie)).toBeNull();
  });

  it('TITLE-003: toggles My List, newest first, keeping a snapshot to render it', () => {
    let s = toggleMyList(initialState(), movie);
    s = toggleMyList(s, series);
    expect(s.myList).toEqual(['20', '10']);
    expect(s.snapshots['10']?.enTitle).toBe('Movie');
    expect(toggleMyList(s, movie).myList).toEqual(['20']);
  });

  it('TITLE-004: rates like/love/dislike, toggling off, and dislikes leave recommendations', () => {
    let s = setRating(initialState(), movie, 'like');
    expect(s.ratings['10']).toBe('like');
    s = setRating(s, movie, 'like');
    expect(s.ratings['10']).toBeUndefined();
    s = setRating(s, movie, 'dislike');
    expect(excludedIds(s).has('10')).toBe(true);
  });

  it('SET-006: clearing history empties Continue Watching but keeps My List and ratings', () => {
    let s = toggleMyList(initialState(), movie);
    s = setRating(s, movie, 'love');
    s = recordProgress(s, { video: movie, series: null, position: 600, duration: 6000, next: null });
    s = clearHistory(s);
    expect(continueWatching(s)).toEqual([]);
    expect(s.myList).toEqual(['10']);
    expect(s.ratings['10']).toBe('love');
  });

  it('SET-007: restores saved settings over defaults and rejects malformed state', () => {
    const saved = updateSettings(initialState(), { level: 2, subtitleLang: 'en' });
    const restored = hydrate(JSON.parse(JSON.stringify({ ...saved, settings: { ...saved.settings, autoplayNext: undefined } })));
    expect(restored.settings).toMatchObject({ level: 2, subtitleLang: 'en', previewAutoplay: true });
    expect(hydrate({ version: 1, settings: { level: 7 } }).settings.level).toBe(0);
    expect(hydrate('garbage')).toEqual(initialState());
    expect(hydrate({ version: 1, myList: ['1', 2, null] }).myList).toEqual(['1']);
  });

  it('SET-001: the family filter setting is stored and drives the API level', () => {
    const s = updateSettings(initialState(), { level: 3 });
    expect(s.settings.level).toBe(3);
    expect(endpoints(s.settings.level).banner()).toContain('/level/3');
    expect(initialState().settings.level).toBe(0);
  });

  it('ONB-001: a fresh install starts with onboarding not done', () => {
    expect(initialState().onboarding.done).toBe(false);
  });

  it('ONB-006: onboarding stores kind and genres and seeds likes', () => {
    const s = completeOnboarding(initialState(), 'series', ['Drama'], [movie]);
    expect(s.onboarding).toEqual({ done: true, kinds: 'series', genres: ['Drama'] });
    expect(s.ratings['10']).toBe('like');
    expect(s.snapshots['10']?.imdbId).toBe('tt0000010');
  });
});
