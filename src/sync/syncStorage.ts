/** The persisted sync state (session, space, cursors, outbox) under one key. Every call reads fresh, so two tabs don't clobber each other. */
import { readJson, removeKey, writeJson, type KV } from '../lib/storage';
import type { SyncPersisted } from './types';

export const SYNC_KEY = 'wmp:sync:v1';

export const emptySync = (): SyncPersisted => ({ v: 1, session: null, spaceId: null, deviceName: '', cursors: {}, outbox: [], firstSyncDone: false });

export function loadSync(kv?: KV | null): SyncPersisted {
  const raw = kv === undefined ? readJson<Partial<SyncPersisted>>(SYNC_KEY) : readJson<Partial<SyncPersisted>>(SYNC_KEY, kv);
  const base = emptySync();
  if (!raw || raw.v !== 1) return base;
  return {
    ...base,
    ...raw,
    cursors: raw.cursors && typeof raw.cursors === 'object' ? raw.cursors : {},
    outbox: Array.isArray(raw.outbox) ? raw.outbox : [],
  };
}

export class SyncStorage {
  constructor(private readonly kv?: KV | null) {}

  get(): SyncPersisted {
    return loadSync(this.kv);
  }

  set(fn: (s: SyncPersisted) => SyncPersisted): SyncPersisted {
    const next = fn(this.get());
    if (this.kv === undefined) writeJson(SYNC_KEY, next);
    else writeJson(SYNC_KEY, next, undefined, this.kv);
    return next;
  }

  clear(): void {
    if (this.kv === undefined) removeKey(SYNC_KEY);
    else removeKey(SYNC_KEY, this.kv);
  }
}

/** Is this browser set up for sync? (cheap check for startup; no engine needed) */
export const isLinked = (kv?: KV | null): boolean => !!loadSync(kv).spaceId;
