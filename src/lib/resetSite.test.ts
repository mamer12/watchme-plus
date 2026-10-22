import { describe, expect, it, vi } from 'vitest';
import { cookieExpiries, parentPaths, resetSite, type ResetEnv } from './resetSite';

function fakeEnv(over: Partial<ResetEnv> = {}) {
  const sets: string[] = [];
  const deleted: string[] = [];
  const cacheDeleted: string[] = [];
  const unregister = vi.fn(async () => true);
  const postMessage = vi.fn();
  const env: ResetEnv = {
    localStorage: { clear: vi.fn() },
    sessionStorage: { clear: vi.fn() },
    indexedDB: { databases: async () => [{ name: 'mylist' }], deleteDatabase: (n) => void deleted.push(n) },
    caches: { keys: async () => ['images', 'api'], delete: async (k) => (cacheDeleted.push(k), true) },
    cookies: { get: () => 'a=1; b=2', set: (v) => void sets.push(v) },
    location: { pathname: '/settings/x', hostname: 'watch.example' },
    serviceWorker: { getRegistrations: async () => [{ unregister, active: { postMessage } }] },
    reload: vi.fn(),
    ...over,
  };
  return { env, sets, deleted, cacheDeleted, unregister, postMessage };
}

describe('resetSite', () => {
  it('SET-009: invokes every step and reloads once at the end', async () => {
    const f = fakeEnv();
    const r = await resetSite(f.env);
    expect(f.env.localStorage!.clear).toHaveBeenCalledTimes(1);
    expect(f.env.sessionStorage!.clear).toHaveBeenCalledTimes(1);
    expect(f.deleted).toContain('mylist');
    expect(f.cacheDeleted).toEqual(['images', 'api']);
    expect(f.sets.length).toBeGreaterThan(0);
    expect(f.postMessage).toHaveBeenCalledWith({ type: 'WMP_RESET' });
    expect(f.unregister).toHaveBeenCalledTimes(1);
    expect(r.failed).toEqual([]);
    expect(r.ok).toHaveLength(6);
    expect(f.env.reload).toHaveBeenCalledTimes(1);
  });

  it('SET-009: continues after a failing step and reports it', async () => {
    const f = fakeEnv({ caches: { keys: async () => { throw new Error('boom'); }, delete: async () => true }, localStorage: { clear: () => { throw new Error('denied'); } } });
    const r = await resetSite(f.env);
    expect(r.failed.map((x) => x.step)).toEqual(['localStorage', 'caches']);
    expect(r.failed[1]?.error).toBe('boom');
    expect(f.unregister).toHaveBeenCalled();
    expect(f.env.reload).toHaveBeenCalledTimes(1);
  });

  it('SET-009: expires cookies on every parent path', () => {
    expect(parentPaths('/a/b')).toEqual(['/a/b', '/a', '/']);
    const out = cookieExpiries('a=1; b=2', '/a/b');
    expect(out).toContain('a=; expires=Thu, 01 Jan 1970 00:00:00 GMT; max-age=0; path=/a/b');
    expect(out).toContain('b=; expires=Thu, 01 Jan 1970 00:00:00 GMT; max-age=0; path=/');
    expect(out).toHaveLength(6);
    expect(cookieExpiries('a=1', '/', 'h.io')).toContain('a=; expires=Thu, 01 Jan 1970 00:00:00 GMT; max-age=0; path=/; domain=.h.io');
    expect(cookieExpiries('', '/')).toEqual([]);
  });

  it('SET-009: is a no-op when browser APIs are missing', async () => {
    const reload = vi.fn();
    const r = await resetSite({ reload });
    expect(r.ok).toEqual([]);
    expect(r.failed).toEqual([]);
    expect(r.skipped).toHaveLength(6);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('SET-009: falls back to known IndexedDB names when databases() is unavailable', async () => {
    const deleted: string[] = [];
    const r = await resetSite({ indexedDB: { deleteDatabase: (n) => void deleted.push(n) }, reload: () => {} });
    expect(r.ok).toEqual(['indexedDB']);
    expect(deleted.length).toBeGreaterThan(0);
  });
});
