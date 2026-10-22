/** Gets playback ready before the player opens: the file list, the signed link and the connection to its host. */
import { getVideoFiles } from '../api/catalog';
import { getIsp } from '../api/endpoints';
import { isAdaptive, readWorkingQuality, startFile } from './adaptiveQuality';
import { addHint } from './hints';
import { parallelWanted } from './parallelPage';
import { fileHostUrl } from './parallelRange';
import { warmUrl } from './signedUrl';

/** Runs `fn` when the browser is idle (soon after, where requestIdleCallback is missing). */
export function whenIdle(fn: () => void): void {
  const w = globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 2000 });
  else setTimeout(fn, 300);
}

/** Warms the file host of the file the player will start with (never `cdn.`, see warmUrl). Only for the mirror; never throws. */
export function warmPlayback(videoId: string): void {
  const isp = getIsp();
  if (!isAdaptive(isp) || !videoId) return;
  getVideoFiles(videoId)
    .then((files) => startFile(files.filter((f) => f.height <= 1080), readWorkingQuality(isp), isp))
    .then(async (file) => {
      if (!file) return;
      await warmUrl(file.url, fetch, Date.now(), { keepLink: parallelWanted() });
      const host = fileHostUrl(file.url);
      if (host) addHint('preconnect', new URL(host).host);
    })
    .catch(() => {});
}
