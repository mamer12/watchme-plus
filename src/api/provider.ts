/**
 * Keeps the active provider right without anyone choosing: detects it on first run, trusts the last answer for 24 h
 * (re-checking quietly), and switches by itself when the catalog stops answering. All I/O is injected.
 */
import { useSyncExternalStore } from 'react';
import { DETECT, detectProvider, realClock, type Clock, type DetectResult } from './detect';
import { FALLBACK_ISP, ISP_CHECKED_KEY, ISP_KEY, getIsp, usableId, type Isp, type Provider } from './endpoints';
import { onCatalogOutcome } from './health';
import { switchIsp } from './switchIsp';

interface Kv {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export interface ProviderDeps {
  fetch: typeof fetch;
  clock: Clock;
  storage: Kv | null;
  /** Makes `id` the active provider (clears provider-keyed caches); `persist` false keeps it for this session. */
  apply(id: Isp, persist: boolean): void;
  getActive(): Isp;
  /** `location.search`. */
  search: string;
  providers?: readonly Provider[];
  /** The window, for the 'online' event. */
  events?: { addEventListener(type: 'online', l: () => void): void };
  /** The document, for coming back to a tab that was hidden for a long time. */
  doc?: { hidden: boolean; addEventListener(type: 'visibilitychange', l: () => void): void };
}

export interface ProviderState {
  /** First run, nothing known yet: the app shows "Finding the best connection...". */
  phase: 'detecting' | 'ready';
  /** A detection round is running. */
  checking: boolean;
  /** `?isp=` fixed the provider for this session: nothing switches by itself. */
  fixed: boolean;
}

type Reason = 'initial' | 'manual' | 'verify' | 'failure' | 'retry' | 'online' | 'visible';
/** Failures in a row on the active provider that trigger a re-detection. */
export const FAILURES_TO_REDETECT = 2;

export function createProviderManager(deps: ProviderDeps) {
  let state: ProviderState = { phase: 'ready', checking: false, fixed: false };
  const subs = new Set<() => void>();
  const set = (patch: Partial<ProviderState>) => {
    state = { ...state, ...patch };
    subs.forEach((l) => l());
  };
  const detectDeps = { fetch: deps.fetch, clock: deps.clock, providers: deps.providers };
  let lastSwitch = -Infinity;
  let inflight: Promise<DetectResult> | null = null;
  let retryIndex = 0;
  let cancelRetry: (() => void) | null = null;
  let streak = 0;
  let started = false;
  let unsubscribe: (() => void) | null = null;

  const read = (k: string): string | null => {
    try {
      return deps.storage?.getItem(k) ?? null;
    } catch {
      return null;
    }
  };
  const write = (k: string, v: string | null) => {
    try {
      if (v === null) deps.storage?.removeItem(k);
      else deps.storage?.setItem(k, v);
    } catch {
      /* storage unavailable: the choice lasts for this session */
    }
  };
  const known = (): Isp | null => usableId(read(ISP_KEY));

  function scheduleRetry(): void {
    cancelRetry?.();
    const delay = DETECT.RETRY_MS[retryIndex];
    if (delay === undefined) return;
    retryIndex++;
    cancelRetry = deps.clock.setTimeout(() => void detect('retry'), delay);
  }

  function detect(reason: Reason): Promise<DetectResult> {
    if (inflight) return inflight;
    set({ checking: true });
    const run = detectProvider(detectDeps).then((res) => {
      const now = deps.clock.now();
      if (res.id) {
        retryIndex = 0;
        cancelRetry?.();
        write(ISP_CHECKED_KEY, String(now));
        const automatic = reason !== 'initial' && reason !== 'manual';
        if (res.id === deps.getActive()) deps.apply(res.id, true);
        else if (!automatic || now - lastSwitch >= DETECT.SWITCH_MIN_GAP_MS) {
          lastSwitch = now;
          deps.apply(res.id, true);
        }
      } else {
        // Keep the last known provider; with none known, the mirror works from most networks.
        if (!known() && state.phase === 'detecting') deps.apply(FALLBACK_ISP, false);
        scheduleRetry();
      }
      return res;
    });
    inflight = run;
    return run.finally(() => {
      inflight = null;
      set({ checking: false, phase: 'ready' });
    });
  }

  function onOutcome(ok: boolean): void {
    if (ok) {
      streak = 0;
      return;
    }
    if (state.fixed || ++streak < FAILURES_TO_REDETECT) return;
    streak = 0;
    void detect('failure');
  }

  return {
    getState: (): ProviderState => state,
    subscribe(l: () => void): () => void {
      subs.add(l);
      return () => subs.delete(l);
    },

    /** Applies the URL override, trusts or re-checks the stored answer, or runs the first detection. */
    async start(): Promise<void> {
      if (started) return;
      started = true;
      const wanted = new URLSearchParams(deps.search).get('isp');
      const forced = usableId(wanted);
      if (forced) {
        write(ISP_CHECKED_KEY, null);
        deps.apply(forced, true);
        set({ fixed: true, phase: 'ready' });
        return;
      }
      unsubscribe = onCatalogOutcome(onOutcome);
      const recheckSilently = (reason: Reason) => {
        if (state.fixed) return;
        retryIndex = 0;
        void detect(reason);
      };
      deps.events?.addEventListener('online', () => recheckSilently('online'));
      let hiddenAt: number | null = null;
      deps.doc?.addEventListener('visibilitychange', () => {
        if (deps.doc?.hidden) hiddenAt = deps.clock.now();
        else if (hiddenAt !== null && deps.clock.now() - hiddenAt > DETECT.HIDDEN_RECHECK_MS) {
          hiddenAt = null;
          recheckSilently('visible');
        } else hiddenAt = null;
      });
      // The cached provider starts working at once; detection always runs behind it. Only a missing or old answer
      // shows the "Finding the best connection..." splash.
      const stored = known();
      const checked = Number(read(ISP_CHECKED_KEY));
      const fresh = stored !== null && checked > 0 && deps.clock.now() - checked < DETECT.TRUST_MS;
      if (!fresh) {
        set({ phase: 'detecting' });
        deps.clock.setTimeout(() => {
          if (state.phase !== 'detecting') return;
          if (!known()) deps.apply(FALLBACK_ISP, false);
          set({ phase: 'ready' });
        }, DETECT.SPLASH_MAX_MS);
      }
      await detect(stored ? 'verify' : 'initial');
    },

    /** For tests: stop listening to catalog outcomes and drop pending retries. */
    stop(): void {
      unsubscribe?.();
      cancelRetry?.();
    },

    /** The Re-check button: detection now; it may switch whenever it likes. */
    async recheck(): Promise<void> {
      retryIndex = 0;
      set({ fixed: false });
      await detect('manual');
    },
  };
}

let singleton: ReturnType<typeof createProviderManager> | null = null;

/** The app's manager, wired to the browser. */
export function providerManager(): ReturnType<typeof createProviderManager> {
  singleton ??= createProviderManager({
    fetch: (i, o) => fetch(i, o),
    clock: realClock,
    storage: (() => {
      try {
        return typeof localStorage !== 'undefined' ? localStorage : null;
      } catch {
        return null;
      }
    })(),
    apply: switchIsp,
    getActive: getIsp,
    search: typeof location !== 'undefined' ? location.search : '',
    events: typeof window !== 'undefined' ? window : undefined,
    doc: typeof document !== 'undefined' ? document : undefined,
  });
  return singleton;
}

export const useProviderState = (): ProviderState => {
  const m = providerManager();
  return useSyncExternalStore(m.subscribe, m.getState, m.getState);
};
