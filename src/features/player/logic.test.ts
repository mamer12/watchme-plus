import { describe, expect, it } from 'vitest';
import { parseTitle } from '../../api/parse';
import type { Title, VideoFile } from '../../api/types';
import {
  clampTime,
  countdownLeft,
  endAction,
  COUNTDOWN_AT_END,
  familySkipTarget,
  familyToggleMessage,
  hevcSupported,
  nextEpisode,
  pickQuality,
  playableFiles,
  previewFile,
  rangeAt,
  seasonsOf,
  nextCardAt,
  nextCardPlan,
  SPEEDS,
  tapZone,
} from './logic';

const f = (h: number): VideoFile => ({ resolution: `${h}p`, height: h, url: `https://cdn/${h}.mp4` });
const files = [240, 360, 480, 720, 1080, 2160].map(f);
const ep = (nb: string, s: number, e: number): Title => parseTitle({ nb, en_title: 'S', kind: '2', season: String(s), episodeNummer: String(e) })!;

describe('player logic', () => {
  it('PLAYER-003: defaults to 1080p, offers 4K only with HEVC support and falls back below the wanted quality', () => {
    expect(hevcSupported({ isTypeSupported: () => false, canPlayType: () => '' })).toBe(false);
    expect(hevcSupported({ isTypeSupported: () => false, canPlayType: () => 'maybe' })).toBe(true);
    expect(hevcSupported({ isTypeSupported: () => true })).toBe(true);
    expect(hevcSupported({ canPlayType: () => { throw new Error('x'); } })).toBe(false);
    expect(playableFiles(files, false).map((x) => x.height)).not.toContain(2160);
    expect(playableFiles(files, true).map((x) => x.height)).toContain(2160);
    expect(pickQuality(playableFiles(files, false), '1080p')?.height).toBe(1080);
    expect(pickQuality(playableFiles(files, false), '2160p')?.height).toBe(1080);
    expect(pickQuality([f(240), f(480), f(1080)], '720p')?.height).toBe(480);
    expect(pickQuality([f(720)], '360p')?.height).toBe(720);
    expect(pickQuality([], '1080p')).toBeNull();
  });

  it('HOME-002: previews use the 480p (else 360p) file', () => {
    expect(previewFile(files)?.height).toBe(480);
    expect(previewFile([f(360), f(1080)])?.height).toBe(360);
    expect(previewFile([f(720), f(1080)])?.height).toBe(720);
  });

  it('PLAYER-007: shows Skip Intro inside the intro window only', () => {
    const intro = [{ start: 228, end: 246.6 }];
    expect(rangeAt(227, intro)).toBeNull();
    expect(rangeAt(230, intro)).toEqual(intro[0]);
    expect(rangeAt(246.5, intro)).toBeNull();
  });

  it('PLAYER-016: the Family mode notice says what will happen', () => {
    expect(familyToggleMessage(false, 3)).toBe('Family mode off');
    expect(familyToggleMessage(true, 0)).toBe('Family mode on · no flagged scenes in this title');
    expect(familyToggleMessage(true, 1)).toBe('Family mode on · 1 scene will be skipped');
    expect(familyToggleMessage(true, 4)).toBe('Family mode on · 4 scenes will be skipped');
  });

  it('PLAYER-008: jumps over flagged scenes only when family skipping is on', () => {
    const scenes = [{ start: 834, end: 966 }];
    expect(familySkipTarget(840, scenes, true)).toBe(966);
    expect(familySkipTarget(840, scenes, false)).toBeNull();
    expect(familySkipTarget(100, scenes, true)).toBeNull();
  });

  it('PLAYER-009: finds the next episode', () => {
    const eps = [ep('1', 1, 1), ep('2', 1, 2), ep('3', 2, 1)];
    expect(nextEpisode(eps, '2')?.id).toBe('3');
    expect(nextEpisode(eps, '3')).toBeNull();
    expect(nextEpisode(eps, 'x')).toBeNull();
  });

  it('PLAYER-009: the countdown runs 5 seconds, only after the video ended, and can be cancelled', () => {
    expect(COUNTDOWN_AT_END).toBe(5);
    expect(countdownLeft(0)).toBe(5);
    expect(countdownLeft(1200)).toBe(4);
    expect(countdownLeft(4999)).toBe(1);
    expect(countdownLeft(5000)).toBe(0);
    const base = { hasNext: true, autoplay: true, suppressed: false };
    expect(endAction({ ...base, ended: true })).toBe('countdown');
    expect(endAction({ ...base, ended: true, suppressed: true })).toBe('upnext'); // cancelled or dismissed
  });

  it('PLAYER-009: the next episode never starts while the video is still playing', () => {
    const base = { hasNext: true, autoplay: true, suppressed: false };
    expect(endAction({ ...base, ended: false })).toBe('none');
    // The button from the card time on is plain: nothing in its plan can advance.
    expect(Object.keys(nextCardPlan(1320, 1318, false))).toEqual(['at', 'show']);
  });

  it('PLAYER-009: with autoplay off the end shows the button only; last episodes and movies show nothing', () => {
    expect(endAction({ ended: true, hasNext: true, autoplay: false, suppressed: false })).toBe('upnext');
    expect(endAction({ ended: true, hasNext: false, autoplay: true, suppressed: false })).toBe('none');
  });

  it('PLAYER-009: a video with a post-credits scene is not cut: the card shows during the credits, the countdown only after the end', () => {
    const duration = 1320; // credits at ~1274 s, a scene plays until 1320 s
    for (const t of [1282, 1300, 1319.9]) {
      expect(nextCardPlan(duration, t, false).show).toBe(true);
      expect(endAction({ ended: false, hasNext: true, autoplay: true, suppressed: false })).toBe('none');
    }
    expect(endAction({ ended: true, hasNext: true, autoplay: true, suppressed: false })).toBe('countdown');
  });

  it('PLAYER-017: 22-minute episode shows the button 8 s into the estimated credits', () => {
    expect(nextCardAt(1320)).toBeCloseTo(1281.8, 1);
    expect(nextCardPlan(1320, 1281, false).show).toBe(false);
    expect(nextCardPlan(1320, 1282, false).show).toBe(true);
  });

  it('PLAYER-017: 45-minute episode shows the button about 86 s before the end', () => {
    expect(2700 - nextCardAt(2700)).toBeCloseTo(86.5, 1);
  });

  it('PLAYER-017: 2-hour film clamps credits to 150 s (but films never show the button)', () => {
    expect(7200 - nextCardAt(7200)).toBeCloseTo(142, 1);
    expect(nextCardPlan(7200, 7100, false, false).show).toBe(false);
  });

  it('PLAYER-017: short clips show the button at 60% and never later than 15 s before the end', () => {
    expect(nextCardAt(100)).toBe(63);
    expect(nextCardAt(60)).toBe(36); // floor 60%
    expect(nextCardAt(30)).toBe(30); // too short: at the end
    expect(nextCardAt(0)).toBe(Infinity);
  });

  it('PLAYER-017: a catalog credits marker replaces the estimate', () => {
    expect(nextCardAt(1320, 1200)).toBe(1208);
    expect(nextCardAt(1320, 100)).toBe(792); // never before 60%
  });

  it('PLAYER-017: a dismissed button stays dismissed and never autoplays at the end', () => {
    expect(nextCardPlan(1320, 1300, true).show).toBe(false);
    expect(endAction({ ended: true, hasNext: true, autoplay: true, suppressed: true })).toBe('upnext');
  });

  it('PLAYER-017: seeking back before the button hides it', () => {
    expect(nextCardPlan(1320, 1300, false).show).toBe(true);
    expect(nextCardPlan(1320, 600, false).show).toBe(false);
  });

  it('PLAYER-011: offers 0.5× to 1.5× playback speeds', () => {
    expect([...SPEEDS]).toEqual([0.5, 0.75, 1, 1.25, 1.5]);
  });

  it('PLAYER-012: maps double-taps to back/forward zones and keeps seeks inside the video', () => {
    expect(tapZone(50, 1000)).toBe('back');
    expect(tapZone(500, 1000)).toBe('center');
    expect(tapZone(900, 1000)).toBe('forward');
    expect(clampTime(-5, 100)).toBe(0);
    expect(clampTime(500, 100)).toBe(99.5);
  });

  it('TITLE-007: lists the seasons of a series in order', () => {
    expect(seasonsOf([ep('1', 2, 1), ep('2', 1, 1), ep('3', 1, 2)])).toEqual([1, 2]);
  });
});
