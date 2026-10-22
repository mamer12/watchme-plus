import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { VideoFile } from '../../api/types';
import { bufferedAhead } from '../../lib/adaptiveQuality';
import { fetchFileSize, knownSizes, probeBandwidth } from '../../lib/fileSize';
import { PF_STAT_MESSAGE, isPfStat } from '../../lib/pfState';
import {
  bufferGrowthSample,
  buildLevels,
  createThroughput,
  qcAborted,
  qcDecide,
  qcStart,
  qcSwitched,
  type BufferMark,
  type QcState,
} from '../../lib/qualityController';
import type { SwapOutcome } from './swapEngine';
import type { FsVideo } from './useActiveVideo';

const TICK_MS = 1000;
/** A buffer-growth sample needs at least this long to mean anything (the browser downloads in chunks). */
const MIN_SAMPLE_MS = 2000;
const SEEK_BLOCK_MS = 5000;
const PROBE_AFTER_HEALTHY_MS = 10_000;
const PROBE_EVERY_MS = 20_000;

interface Options {
  video: RefObject<FsVideo>;
  files: VideoFile[];
  /** The file on screen. */
  quality: VideoFile | null;
  /** Auto is on (no fixed quality picked). */
  auto: boolean;
  cap: number;
  /** Starts the seamless swap to `file`. */
  swapTo: (file: VideoFile) => Promise<SwapOutcome>;
  swapBusy: () => boolean;
  /** Bumped when another title starts, so the controller starts over. */
  resetKey: string;
}

/** Feeds the QualityController with measurements once a second and obeys it. Pure decisions are in lib/qualityController. */
export function useAutoQuality(o: Options) {
  const latest = useRef(o);
  latest.current = o;
  const state = useRef<QcState>(qcStart(Date.now()));
  const mark = useRef<BufferMark | null>(null);
  const meter = useRef(createThroughput());
  const swapping = useRef(false);
  const probing = useRef(false);
  const lastProbe = useRef(0);

  // Sizes give each file's bitrate; they are fetched once per title, lowest first.
  useEffect(() => {
    let alive = true;
    void (async () => {
      for (const f of [...o.files].sort((x, y) => x.height - y.height)) {
        if (!alive) return;
        await fetchFileSize(f.url);
      }
    })();
    return () => {
      alive = false;
    };
  }, [o.files]);

  useEffect(() => {
    state.current = qcStart(Date.now());
    mark.current = null;
  }, [o.resetKey]);

  useEffect(() => {
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
    const on = (e: MessageEvent) => {
      if (!isPfStat(e.data) || e.data.type !== PF_STAT_MESSAGE) return;
      if (e.data.bytes > 0 && e.data.ms > 0) meter.current.floor((e.data.bytes / e.data.ms) * 1000);
    };
    sw?.addEventListener('message', on);
    return () => sw?.removeEventListener('message', on);
  }, []);

  /** Lets the controller decide again at once (the viewer went back to Auto). */
  const rearm = useCallback(() => {
    state.current = { ...qcStart(Date.now()), lastSwitch: -Infinity };
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const { video, files, quality, auto, cap, swapTo, swapBusy } = latest.current;
      const v = video.current;
      const now = Date.now();
      if (!v || !quality || v.ended || !(v.duration > 0)) return;
      const levels = buildLevels(files, knownSizes(), v.duration);
      const cur = levels.find((l) => l.height === quality.height);
      const ahead = bufferedAhead(v.buffered, v.currentTime);
      let end = v.currentTime;
      for (let i = 0; i < v.buffered.length; i++) if (v.currentTime >= v.buffered.start(i) - 0.25 && v.currentTime <= v.buffered.end(i)) end = v.buffered.end(i);
      const cur$ = { end, at: now };
      if (!mark.current || v.seeking) mark.current = cur$;
      else if (now - mark.current.at >= MIN_SAMPLE_MS) {
        const s = bufferGrowthSample(mark.current, cur$, cur?.bytesPerSec ?? 0, ahead);
        // A browser that buffers on demand grows its buffer at the playback rate however fast the line is: with a
        // comfortable buffer that is a floor, not a measurement. Only a hungry buffer (under 2 s) measures the line.
        if (s) {
          if (ahead >= 2) meter.current.floor((s.bytes / s.ms) * 1000);
          else meter.current.sample(s.bytes, s.ms);
        }
        mark.current = cur$;
      }
      const r = qcDecide(state.current, {
        now,
        levels,
        currentHeight: quality.height,
        cap,
        throughput: meter.current.get(),
        ahead,
        playing: !v.paused && !v.seeking,
        auto,
      });
      state.current = r.state;
      // Healthy for a while but no proof the line can carry the next level: measure it directly (1 MB, at most every 20 s).
      const healthy = r.state.healthySince !== null && now - r.state.healthySince >= PROBE_AFTER_HEALTHY_MS;
      const nextLevel = files.filter((f) => f.height > quality.height && f.height <= cap).sort((x, y) => x.height - y.height)[0];
      if (auto && healthy && nextLevel && !probing.current && !swapping.current && now - lastProbe.current >= PROBE_EVERY_MS) {
        probing.current = true;
        lastProbe.current = now;
        void probeBandwidth(nextLevel.url, knownSizes().get(nextLevel.url) ?? null).then((bps) => {
          probing.current = false;
          if (bps) meter.current.sample(bps, 1000);
        });
      }
      if (r.target === null || swapping.current || swapBusy()) return;
      const file = files.find((f) => f.height === r.target);
      if (!file) return;
      swapping.current = true;
      void swapTo(file).then((out) => {
        swapping.current = false;
        const t = Date.now();
        if (out === 'swapped') state.current = qcSwitched(state.current, t);
        else if (out === 'timeout' || out === 'error') state.current = qcAborted(state.current, t);
        else state.current = { ...state.current, blockedUntil: t + SEEK_BLOCK_MS };
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  return { rearm, throughput: () => meter.current.get(), noteSwitched: () => (state.current = qcSwitched(state.current, Date.now())) };
}
