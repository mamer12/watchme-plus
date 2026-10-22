/** Automatic provider detection. Pure: fetch and clock are injected, so every timing rule is unit-testable. */
import { probeUrl, usableProviders, type Isp, type Provider } from './endpoints';

export const DETECT = {
  /** One probe gives up after this long. */
  PROBE_TIMEOUT_MS: 3500,
  /** After the first success, wait this long for higher-priority providers. */
  GRACE_MS: 1500,
  /** Delays between retries when nothing answered. */
  RETRY_MS: [2000, 6000, 15000],
  /** A detection result is trusted this long. */
  TRUST_MS: 24 * 60 * 60 * 1000,
  /** Automatic switches are at most this often. */
  SWITCH_MIN_GAP_MS: 60_000,
  /** Coming back to a tab hidden this long re-runs detection. */
  HIDDEN_RECHECK_MS: 30 * 60_000,
  /** The first-run splash never waits longer than this. */
  SPLASH_MAX_MS: 4000,
} as const;

export interface Clock {
  now(): number;
  /** Runs `fn` after `ms`; returns a canceller. */
  setTimeout(fn: () => void, ms: number): () => void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const t = globalThis.setTimeout(fn, ms);
    return () => globalThis.clearTimeout(t);
  },
};

export interface DetectDeps {
  fetch: typeof fetch;
  clock: Clock;
  /** Defaults to the usable providers of the registry. */
  providers?: readonly Provider[];
}

export interface DetectResult {
  /** The provider to use, or null when none answered. */
  id: Isp | null;
  /** Per probed provider: true answered, false failed, undefined still pending when the winner was picked. */
  ok: Partial<Record<Isp, boolean>>;
}

/** One cheap request: the body must be a JSON array (captive portals and block pages answer 200 with HTML). */
export async function probeProvider(p: Provider, deps: DetectDeps, outer?: AbortSignal): Promise<boolean> {
  const ctl = new AbortController();
  const cancelTimer = deps.clock.setTimeout(() => ctl.abort(), DETECT.PROBE_TIMEOUT_MS);
  const onOuter = () => ctl.abort();
  outer?.addEventListener('abort', onOuter);
  try {
    const res = await deps.fetch(probeUrl(p), { mode: 'cors', cache: 'no-store', signal: ctl.signal });
    if (!res.ok) return false;
    return Array.isArray(await res.json());
  } catch {
    return false;
  } finally {
    cancelTimer();
    outer?.removeEventListener('abort', onOuter);
  }
}

/**
 * Probes every usable provider in parallel and picks by priority: the top one answering OK wins at once; otherwise the
 * best answer wins GRACE_MS after the first success. Resolves with `id: null` when all of them fail.
 */
export function detectProvider(deps: DetectDeps): Promise<DetectResult> {
  const list = usableProviders(deps.providers);
  const ok: Partial<Record<Isp, boolean>> = {};
  const outer = new AbortController();
  return new Promise((resolve) => {
    let done = false;
    let cancelGrace: (() => void) | null = null;
    const finish = (id: Isp | null) => {
      if (done) return;
      done = true;
      cancelGrace?.();
      outer.abort();
      resolve({ id, ok: { ...ok } });
    };
    const decide = (final: boolean) => {
      const best = list.findIndex((p) => ok[p.id] === true);
      if (best >= 0 && (final || list.slice(0, best).every((p) => ok[p.id] === false))) return finish(list[best]!.id);
      if (best < 0 && list.every((p) => ok[p.id] === false)) finish(null);
    };
    if (!list.length) return finish(null);
    list.forEach((p) => {
      void probeProvider(p, deps, outer.signal).then((good) => {
        if (done) return;
        ok[p.id] = good;
        if (good && !cancelGrace) cancelGrace = deps.clock.setTimeout(() => decide(true), DETECT.GRACE_MS);
        decide(false);
      });
    });
  });
}
