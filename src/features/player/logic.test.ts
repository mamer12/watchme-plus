import { describe, expect, it } from 'vitest';
import { parseTitle } from '../../api/parse';
import type { Title, VideoFile } from '../../api/types';
import {
  clampTime,
  countdownProgress,
  familySkipTarget,
  familyToggleMessage,
  hevcSupported,
  nextEpisode,
  pickQuality,
  playableFiles,
  previewFile,
  rangeAt,
  seasonsOf,
  showNextCard,
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

  it('PLAYER-009: shows Next Episode in the last 40 seconds with a 10-second countdown', () => {
    const eps = [ep('1', 1, 1), ep('2', 1, 2), ep('3', 2, 1)];
    expect(nextEpisode(eps, '2')?.id).toBe('3');
    expect(nextEpisode(eps, '3')).toBeNull();
    expect(nextEpisode(eps, 'x')).toBeNull();
    expect(showNextCard(41, true, false)).toBe(false);
    expect(showNextCard(40, true, false)).toBe(true);
    expect(showNextCard(10, true, true)).toBe(false);
    expect(showNextCard(10, false, false)).toBe(false);
    expect(countdownProgress(0)).toBe(0);
    expect(countdownProgress(5000)).toBe(0.5);
    expect(countdownProgress(12000)).toBe(1);
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
