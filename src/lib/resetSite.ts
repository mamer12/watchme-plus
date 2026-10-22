import { syncSignOutLocal } from '../sync/bridge';

/** "Reset this site": deletes everything this origin stored in the browser. Every API is injectable and optional. */

export type ResetStep = 'sync' | 'localStorage' | 'sessionStorage' | 'indexedDB' | 'caches' | 'cookies' | 'serviceWorker';

export interface ResetEnv {
  localStorage?: Pick<Storage, 'clear'> | null;
  sessionStorage?: Pick<Storage, 'clear'> | null;
  indexedDB?: { databases?: () => Promise<{ name?: string }[]>; deleteDatabase: (name: string) => unknown } | null;
  caches?: { keys: () => Promise<string[]>; delete: (name: string) => Promise<boolean> } | null;
  /** The `document.cookie` accessor. */
  cookies?: { get: () => string; set: (value: string) => void } | null;
  /** Where the page is, to expire cookies on the current path and its parents. */
  location?: { pathname: string; hostname: string };
  serviceWorker?: {
    getRegistrations: () => Promise<readonly { unregister: () => Promise<boolean>; active?: { postMessage: (m: unknown) => void } | null }[]>;
  } | null;
  /** Signs this browser out of sync (stops the engine, forgets the session). Server data is not touched. */
  signOutSync?: () => void;
  /** Called once, last. */
  reload: () => void;
}

export interface ResetResult {
  ok: ResetStep[];
  failed: { step: ResetStep; error: string }[];
  skipped: ResetStep[];
}

/** Databases to delete when `indexedDB.databases()` is missing (Firefox < 126, older Safari). */
export const KNOWN_IDB_NAMES = ['keyval-store', 'react-query', 'REACT_QUERY_OFFLINE_CACHE', 'wmp', 'wmp-db', 'workbox-expiration'];

export const RESET_MESSAGE = { type: 'WMP_RESET' } as const;

const EXPIRED = 'Thu, 01 Jan 1970 00:00:00 GMT';

/** "/a/b" → ["/a/b", "/a", "/"]. */
export function parentPaths(pathname: string): string[] {
  const parts = pathname.split('/').filter(Boolean);
  const out: string[] = [];
  for (let i = parts.length; i > 0; i--) out.push('/' + parts.slice(0, i).join('/'));
  out.push('/');
  return out;
}

/** One Set-Cookie string per cookie, path and domain variant, all expired. */
export function cookieExpiries(cookieString: string, pathname: string, hostname = ''): string[] {
  const names = cookieString
    .split(';')
    .map((c) => (c.split('=')[0] ?? '').trim())
    .filter(Boolean);
  const domains = ['', ...(hostname ? [`; domain=${hostname}`, `; domain=.${hostname}`] : [])];
  const out: string[] = [];
  for (const name of names) {
    for (const path of parentPaths(pathname)) {
      for (const domain of domains) out.push(`${name}=; expires=${EXPIRED}; max-age=0; path=${path}${domain}`);
    }
  }
  return out;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function resetSite(env: ResetEnv): Promise<ResetResult> {
  const result: ResetResult = { ok: [], failed: [], skipped: [] };

  const run = async (step: ResetStep, available: boolean, fn: () => unknown) => {
    if (!available) {
      result.skipped.push(step);
      return;
    }
    try {
      await fn();
      result.ok.push(step);
    } catch (e) {
      result.failed.push({ step, error: message(e) });
    }
  };

  // Sync first: nothing may re-save its state after the storage is wiped.
  if (env.signOutSync) await run('sync', true, () => env.signOutSync!());
  await run('localStorage', !!env.localStorage, () => env.localStorage!.clear());
  await run('sessionStorage', !!env.sessionStorage, () => env.sessionStorage!.clear());

  await run('indexedDB', !!env.indexedDB, async () => {
    const idb = env.indexedDB!;
    const names = new Set(KNOWN_IDB_NAMES);
    if (typeof idb.databases === 'function') {
      try {
        for (const d of await idb.databases()) if (d.name) names.add(d.name);
      } catch {
        /* fall back to the known names */
      }
    }
    for (const name of names) idb.deleteDatabase(name);
  });

  await run('caches', !!env.caches, async () => {
    const c = env.caches!;
    const keys = await c.keys();
    const results = await Promise.allSettled(keys.map((k) => c.delete(k)));
    const bad = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    if (bad) throw bad.reason;
  });

  await run('cookies', !!env.cookies, () => {
    const loc = env.location ?? { pathname: '/', hostname: '' };
    for (const c of cookieExpiries(env.cookies!.get(), loc.pathname, loc.hostname)) env.cookies!.set(c);
  });

  await run('serviceWorker', !!env.serviceWorker, async () => {
    const regs = await env.serviceWorker!.getRegistrations();
    for (const r of regs) {
      try {
        r.active?.postMessage(RESET_MESSAGE);
      } catch {
        /* unregistering below still works */
      }
    }
    await Promise.all(regs.map((r) => r.unregister()));
  });

  env.reload();
  return result;
}

/** The real browser APIs, each guarded because any of them can throw or be missing. */
export function browserResetEnv(reload: () => void): ResetEnv {
  const safe = <T>(f: () => T | undefined): T | null => {
    try {
      return f() ?? null;
    } catch {
      return null;
    }
  };
  return {
    localStorage: safe(() => window.localStorage),
    sessionStorage: safe(() => window.sessionStorage),
    indexedDB: safe(() => window.indexedDB),
    caches: safe(() => window.caches),
    cookies: safe(() => ({
      get: () => document.cookie,
      set: (v: string) => {
        document.cookie = v;
      },
    })),
    location: { pathname: window.location.pathname, hostname: window.location.hostname },
    serviceWorker: safe(() => navigator.serviceWorker),
    signOutSync: syncSignOutLocal,
    reload,
  };
}
