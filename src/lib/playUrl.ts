/** The address a <video> should load for a file: the file host behind the 302 (resolved ahead), or the original link. */
import { resolvedUrl, warmUrl } from './signedUrl';

/** Longest to hold the video back for the 302 to be resolved. */
export const RESOLVE_WAIT_MS = 1500;

export function resolvePlayUrl(link: string, opts: { adaptive: boolean; parallel: boolean }): Promise<string> {
  const known = resolvedUrl(link);
  if (!opts.adaptive || known !== link) return Promise.resolve(known);
  const wait = new Promise<string>((r) => setTimeout(() => r(link), RESOLVE_WAIT_MS));
  return Promise.race([warmUrl(link, fetch, Date.now(), { keepLink: opts.parallel }), wait]);
}
