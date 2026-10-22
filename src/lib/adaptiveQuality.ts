/** Where playback starts and what is remembered between visits. The ongoing decisions are in qualityController. */
import type { VideoFile } from '../api/types';
import { providerById, type Isp } from '../api/endpoints';
import { QC } from './qualityController';

export const AQ = {
  /** Start height on the mirror. */
  START_HEIGHT: 480,
  MIN_START_HEIGHT: 360,
  /** Start height ceiling on EL. */
  EL_START_MAX: 720,
} as const;

export const AQ_KEY_PREFIX = 'wmp:aq:';

/** Only the mirror starts low and gets lighter artwork. */
export const isAdaptive = (isp: Isp): boolean => providerById(isp)?.defaultQuality !== undefined;

/**
 * The first file: the remembered one for this provider (within the cap); else on the mirror 480p (else the lowest of at
 * least 360p), on EL the highest up to 720p.
 */
export function startFile(files: VideoFile[], saved?: string | null, isp: Isp = 'other', cap: number = QC.DEFAULT_CAP): VideoFile | null {
  if (!files.length) return null;
  const all = [...files].sort((a, b) => a.height - b.height);
  const within = all.filter((f) => f.height <= cap);
  const sorted = within.length ? within : all.slice(0, 1);
  const want = saved ? Number.parseInt(saved, 10) : NaN;
  const remembered = Number.isFinite(want) ? sorted.find((f) => f.height === want) : undefined;
  if (remembered) return remembered;
  if (isp === 'el') {
    const low = sorted.filter((f) => f.height <= AQ.EL_START_MAX);
    return low[low.length - 1] ?? sorted[0] ?? null;
  }
  return (
    sorted.find((f) => f.height === AQ.START_HEIGHT) ??
    sorted.find((f) => f.height >= AQ.MIN_START_HEIGHT) ??
    sorted[sorted.length - 1] ??
    null
  );
}

/** Seconds buffered after `time`, from the video's buffered ranges. */
export function bufferedAhead(ranges: { length: number; start(i: number): number; end(i: number): number }, time: number): number {
  for (let i = 0; i < ranges.length; i++) {
    if (time >= ranges.start(i) - 0.25 && time <= ranges.end(i)) return Math.max(0, ranges.end(i) - time);
  }
  return 0;
}

interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}
const local = (): Store | null => {
  try {
    return (globalThis as { localStorage?: Store }).localStorage ?? null;
  } catch {
    return null;
  }
};

/** The quality that worked last time on this provider, e.g. "360p": a starting point only. */
export function readWorkingQuality(isp: Isp, store: Store | null = local()): string | null {
  try {
    const v = store?.getItem(AQ_KEY_PREFIX + isp);
    return v && /^\d{3,4}p$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function writeWorkingQuality(isp: Isp, resolution: string, store: Store | null = local()): void {
  try {
    store?.setItem(AQ_KEY_PREFIX + isp, resolution);
  } catch {
    /* storage full or blocked: the next visit starts at the default again */
  }
}
