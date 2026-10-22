/** Player decisions that don't need a DOM. Pure. */
import type { Range, Title, VideoFile } from '../../api/types';

export const HEVC_TYPE = 'video/mp4; codecs="hvc1.1.6.L150.90"';
export const CREDITS_FRACTION = 0.035;
export const CREDITS_MIN_SECONDS = 45;
export const CREDITS_MAX_SECONDS = 150;
/** The card appears this long after the credits are estimated to start. */
export const CARD_AFTER_CREDITS_SECONDS = 8;
export const CARD_MIN_FRACTION = 0.6;
export const CARD_LAST_SECONDS = 15;
/** Seconds the viewer can cancel the autoplay countdown, started only when the video has ended. */
export const COUNTDOWN_AT_END = 5;
export const SEEK_STEP = 10;
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5] as const;
export const DEFAULT_QUALITY = '1080p';

export interface HevcProbe {
  isTypeSupported?: (type: string) => boolean;
  canPlayType?: (type: string) => string;
}

/** 4K files are HEVC: offer them only where the browser says it can decode them. */
export function hevcSupported(probe: HevcProbe): boolean {
  try {
    if (probe.isTypeSupported?.(HEVC_TYPE)) return true;
    const v = probe.canPlayType?.(HEVC_TYPE) ?? '';
    return v === 'probably' || v === 'maybe';
  } catch {
    return false;
  }
}

export function playableFiles(files: VideoFile[], hevc: boolean): VideoFile[] {
  return files.filter((f) => f.height <= 1080 || hevc);
}

/** The preferred quality, else the best one below it, else the lowest available. */
export function pickQuality(files: VideoFile[], preferred: string): VideoFile | null {
  if (!files.length) return null;
  const want = Number.parseInt(preferred, 10) || 1080;
  const sorted = [...files].sort((a, b) => a.height - b.height);
  const below = sorted.filter((f) => f.height <= want);
  return below[below.length - 1] ?? sorted[0] ?? null;
}

/** Small file for the muted billboard preview. */
export function previewFile(files: VideoFile[]): VideoFile | null {
  return files.find((f) => f.height === 480) ?? files.find((f) => f.height === 360) ?? pickQuality(files, '480p');
}

export function rangeAt(t: number, ranges: Range[]): Range | null {
  return ranges.find((r) => t >= r.start && t < r.end - 0.25) ?? null;
}

/** When family skipping is on and playback is inside a flagged scene, where to jump. */
export function familySkipTarget(t: number, ranges: Range[], enabled: boolean): number | null {
  if (!enabled) return null;
  const r = rangeAt(t, ranges);
  return r ? r.end : null;
}

export function nextEpisode(episodes: Title[], currentId: string): Title | null {
  const i = episodes.findIndex((e) => e.id === currentId);
  return i >= 0 ? episodes[i + 1] ?? null : null;
}

export interface NextCardPlan {
  /** Playback time (s) from which the button is shown. */
  at: number;
  show: boolean;
}

/** Playback time at which the Next Episode card appears. `creditsStart` replaces the estimate when the catalog has one. */
export function nextCardAt(duration: number, creditsStart?: number | null): number {
  if (!Number.isFinite(duration) || duration <= 0) return Infinity;
  const len = Math.min(CREDITS_MAX_SECONDS, Math.max(CREDITS_MIN_SECONDS, CREDITS_FRACTION * duration));
  const start = creditsStart != null && creditsStart > 0 && creditsStart < duration ? creditsStart : duration - len;
  const earliest = CARD_MIN_FRACTION * duration;
  const latest = duration - CARD_LAST_SECONDS;
  if (latest < earliest) return duration; // too short for a card: show it at the end
  return Math.min(latest, Math.max(earliest, start + CARD_AFTER_CREDITS_SECONDS));
}

/**
 * The plain "Next episode" button: shown from `at` while the video still plays, never without a next episode or after a
 * dismissal. It has no countdown and never advances by itself.
 */
export function nextCardPlan(duration: number, now: number, dismissed: boolean, hasNext = true, creditsStart?: number | null): NextCardPlan {
  const at = nextCardAt(duration, creditsStart);
  return { at, show: hasNext && !dismissed && Number.isFinite(at) && now >= at };
}

export type EndAction = 'none' | 'countdown' | 'upnext';

/**
 * What happens when the video ends naturally (after-credits scenes are part of the file, so this is the only moment
 * the next episode may start by itself). A dismissed button or a cancelled countdown never autoplays.
 */
export function endAction(o: { ended: boolean; hasNext: boolean; autoplay: boolean; suppressed: boolean }): EndAction {
  if (!o.ended || !o.hasNext) return 'none';
  return o.autoplay && !o.suppressed ? 'countdown' : 'upnext';
}

/** Whole seconds left on the end-of-video countdown ("Next episode in 5"); 0 means go now. */
export function countdownLeft(elapsedMs: number): number {
  return Math.min(COUNTDOWN_AT_END, Math.max(0, Math.ceil(COUNTDOWN_AT_END - elapsedMs / 1000)));
}

export function seasonsOf(episodes: Title[]): number[] {
  return [...new Set(episodes.map((e) => e.season ?? 1))].sort((a, b) => a - b);
}

export function clampTime(t: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return Math.max(0, t);
  return Math.min(Math.max(0, t), Math.max(0, duration - 0.5));
}

/** Double-tap on the left third seeks back, on the right third forward. */
export function tapZone(x: number, width: number): 'back' | 'forward' | 'center' {
  if (width <= 0) return 'center';
  const f = x / width;
  return f < 0.35 ? 'back' : f > 0.65 ? 'forward' : 'center';
}

/** The notice shown when Family mode is switched from the player. */
export function familyToggleMessage(on: boolean, flaggedScenes: number): string {
  if (!on) return 'Family mode off';
  if (flaggedScenes <= 0) return 'Family mode on · no flagged scenes in this title';
  return `Family mode on · ${flaggedScenes} ${flaggedScenes === 1 ? 'scene' : 'scenes'} will be skipped`;
}
