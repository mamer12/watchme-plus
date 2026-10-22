/** Test doubles for the sync engine. */
import { vi } from 'vitest';
import { parseTitle } from '../api/parse';
import type { Title } from '../api/types';
import { hydrate, initialState, type LibraryState } from '../state/library';
import { memoryStore } from '../lib/storage';
import { SyncEngine, type EnvLike, type ProfilesLike, type StoreLike } from './engine';
import { SyncStorage } from './syncStorage';
import { SyncHttpError, type RemoteRow, type SyncApi, type Table } from './types';

export const movie = (nb: string): Title => parseTitle({ nb, en_title: `Movie ${nb}`, kind: '1', imdbUrlRef: `tt00000${nb}`, categories: [{ en_title: 'Action' }] })!;
export const episode = (nb: string, e: number): Title => parseTitle({ nb, en_title: 'Show', kind: '2', season: '1', episodeNummer: String(e) })!;

export class FakeApi implements SyncApi {
  uid = 'me';
  calls: { table: Table; rows: Record<string, unknown>[]; keepalive: boolean; at: number }[] = [];
  pulls: { table: Table; cursor: string | null }[] = [];
  remote: Record<Table, RemoteRow[]> = { watch_progress: [], my_list: [], ratings: [], settings: [] };
  failWith: (() => Error | null) | null = null;
  fresh = true;
  userId = () => this.uid;
  tokenFresh = () => this.fresh;
  async upsert(table: Table, rows: Record<string, unknown>[], opts: { keepalive?: boolean } = {}): Promise<void> {
    const err = this.failWith?.();
    if (err) throw err;
    this.calls.push({ table, rows, keepalive: !!opts.keepalive, at: Date.now() });
  }
  async pull(table: Table, _space: string, cursor: string | null, limit: number): Promise<RemoteRow[]> {
    this.pulls.push({ table, cursor });
    const err = this.failWith?.();
    if (err) throw err;
    return this.remote[table].filter((r) => !cursor || r.updated_at >= cursor).sort((a, b) => a.updated_at.localeCompare(b.updated_at)).slice(0, limit);
  }
}

export function fakeStore(initial: LibraryState = initialState()): StoreLike & { replace(s: LibraryState): void } {
  let state = hydrate(initial);
  const ls = new Set<() => void>();
  return {
    getState: () => state,
    update(fn) {
      const next = fn(state);
      if (next === state) return;
      state = next;
      ls.forEach((l) => l());
    },
    replace(s) {
      state = s;
    },
    subscribe(l) {
      ls.add(l);
      return () => ls.delete(l);
    },
  };
}

export function fakeEnv() {
  let wake: (() => void)[] = [];
  let leave: (() => void)[] = [];
  const env: EnvLike & { visible: boolean; online: boolean; fireWake(): void; fireLeave(): void } = {
    visible: true,
    online: true,
    isVisible: () => env.visible,
    isOnline: () => env.online,
    onWake(cb: () => void) {
      wake.push(cb);
      return () => void (wake = wake.filter((x) => x !== cb));
    },
    onLeave(cb: () => void) {
      leave.push(cb);
      return () => void (leave = leave.filter((x) => x !== cb));
    },
    fireWake: () => wake.forEach((f) => f()),
    fireLeave: () => leave.forEach((f) => f()),
  };
  return env;
}

export function setup(opts: { state?: LibraryState; api?: FakeApi; storage?: SyncStorage; linked?: boolean; firstSyncDone?: boolean; profiles?: ProfilesLike } = {}) {
  const api = opts.api ?? new FakeApi();
  const storage = opts.storage ?? new SyncStorage(memoryStore());
  if (opts.linked !== false) storage.set((s) => ({ ...s, spaceId: 'space-1', deviceName: 'Laptop', firstSyncDone: opts.firstSyncDone ?? true }));
  const store = fakeStore(opts.state);
  const env = fakeEnv();
  const engine = new SyncEngine({ api, storage, store, env, profiles: opts.profiles, now: () => Date.now(), random: () => 0.5 });
  return { api, storage, store, env, engine };
}

/** Lets pending promises and timers up to `ms` run. */
export const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

export const row = (over: Record<string, unknown>): RemoteRow => ({ updated_at: '2026-01-01T10:00:00+00:00', updated_by: 'other', deleted: false, ...over }) as RemoteRow;
export { SyncHttpError };
