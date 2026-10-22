/** Pure parts of "updates must reach users" and the `?reset=1` startup hook. */

export const RELOAD_KEY = 'wmp:update-reload';
/** A reload for an update is allowed again after this long; inside it, a second one means a loop. */
export const RELOAD_GUARD_MS = 60_000;

/** `?reset=1` (also `?reset`, `?reset=true`) or `#reset` / `#reset=1` asks for a full reset on startup. */
export function isResetRequested(search: string, hash = ''): boolean {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (q.has('reset')) {
    const v = (q.get('reset') ?? '').toLowerCase();
    if (v === '' || v === '1' || v === 'true') return true;
  }
  const h = hash.replace(/^#/, '').toLowerCase();
  return h === 'reset' || h === 'reset=1' || h === 'reset=true';
}

/**
 * Reload once when a new service worker takes over a page that an older one controlled. The first install (no earlier
 * controller) has nothing stale to replace, and a recent reload (`lastReloadAt`) means the reload must not repeat.
 */
export function shouldReloadForUpdate(o: { hadController: boolean; lastReloadAt: number | null; now: number }): boolean {
  if (!o.hadController) return false;
  return o.lastReloadAt === null || !Number.isFinite(o.lastReloadAt) || o.now - o.lastReloadAt >= RELOAD_GUARD_MS || o.now < o.lastReloadAt;
}

interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

/** Wires the controllerchange reload with a sessionStorage guard. Never throws. */
export function reloadOnUpdate(
  sw: { controller: unknown; addEventListener(t: 'controllerchange', fn: () => void): void } | undefined,
  store: Store | null,
  reload: () => void,
  now: () => number = Date.now,
): void {
  if (!sw) return;
  const hadController = !!sw.controller;
  sw.addEventListener('controllerchange', () => {
    let last: number | null = null;
    try {
      const v = store?.getItem(RELOAD_KEY);
      last = v ? Number(v) : null;
    } catch {
      /* no storage: the once-per-page flag below still stops a loop */
    }
    if (!shouldReloadForUpdate({ hadController, lastReloadAt: last, now: now() })) return;
    try {
      store?.setItem(RELOAD_KEY, String(now()));
    } catch {
      /* ignore */
    }
    reload();
  });
}
