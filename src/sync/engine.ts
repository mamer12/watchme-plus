/** The sync engine: local-first, an outbox that survives reloads, delta pulls, throttled progress pushes.
 * Everything it touches is injected (backend, library store, storage, clock, page events), so it runs in tests as is.
 */
import type { LibraryState } from '../state/library';
import type { StoredProfile } from '../profiles/types';
import { MAIN_ID } from '../profiles/types';
import { legacyTombstone, parseKey, PROFILES_ROW_KEY } from './keys';
import { diffState, initialUpload, profilesItem } from './mapping';
import { pickProfilesRow } from './profilesRow';
import { applyRemoteRows } from './merge';
import { setSyncStatus } from './status';
import type { SyncStorage } from './syncStorage';
import { SyncHttpError, TABLES, type OutboxItem, type RemoteRow, type SyncApi, type Table } from './types';

export const PROGRESS_PUSH_MS = 15_000;
export const PUSH_DEBOUNCE_MS = 1_500;
export const POLL_MS = 60_000;
export const PAGE_SIZE = 1000;
const PUSH_BATCH = 200;
/** A keepalive request body may not exceed 64 KB. */
const KEEPALIVE_ITEMS = 40;
const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 5 * 60_000;

/** Wait before retry number `attempt` (1 = first retry): 2 s, 4 s, 8 s ... up to 5 min, with a little jitter. */
export function retryDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.8 + 0.4 * random()));
}

export interface StoreLike {
  getState(): LibraryState;
  update(fn: (s: LibraryState) => LibraryState): void;
  subscribe(l: () => void): () => void;
}

export interface EnvLike {
  isVisible(): boolean;
  isOnline(): boolean;
  /** Calls back when the tab becomes visible or the network comes back; returns the unsubscribe. */
  onWake(cb: () => void): () => void;
  /** Calls back when the page is hidden or being closed. */
  onLeave(cb: () => void): () => void;
}

/** The profile list and which profile is on screen. Absent in tests of a single library: then it is just 'main'. */
export interface ProfilesLike {
  activeId(): string;
  snapshot(): { list: StoredProfile[]; updatedAt: number };
  /** A newer list from another device. */
  apply(list: StoredProfile[], updatedAt: number): void;
  /** The list changed here (not from sync). */
  onLocalChange(cb: (list: StoredProfile[], updatedAt: number) => void): () => void;
  /** Every profile's library, for the first upload after linking. */
  libraries(): { id: string; state: LibraryState }[];
}

const soloProfiles = (store: StoreLike): ProfilesLike => ({
  activeId: () => MAIN_ID,
  snapshot: () => ({ list: [], updatedAt: 0 }),
  apply: () => {},
  onLocalChange: () => () => {},
  libraries: () => [{ id: MAIN_ID, state: store.getState() }],
});

export interface EngineDeps {
  profiles?: ProfilesLike;
  api: SyncApi;
  storage: SyncStorage;
  store: StoreLike;
  env: EnvLike;
  now: () => number;
  random?: () => number;
  /** Starts realtime for a space; the returned function stops it. */
  realtime?: (spaceId: string, onRow: (table: Table, row: RemoteRow) => void) => () => void;
}

const errStatus = (e: unknown): number => (e instanceof SyncHttpError ? e.status : 0);
/** Errors that mean one particular row is bad and retrying it can never work. */
const isPoison = (status: number): boolean => status === 400 || status === 409 || status === 422;

export class SyncEngine {
  private prev: LibraryState;
  private applying = false;
  private running = false;
  private chain: Promise<unknown> = Promise.resolve();
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private pushDue = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private attempts = 0;
  private lastProgressPush = -Infinity;
  private playingId: string | null = null;
  private offs: (() => void)[] = [];
  private stopRealtime: (() => void) | null = null;
  private firstApplied = 0;
  private firstFrom: string | null = null;
  private readonly profiles: ProfilesLike;
  dropped = 0;

  constructor(private readonly d: EngineDeps) {
    this.prev = d.store.getState();
    this.profiles = d.profiles ?? soloProfiles(d.store);
  }

  private get spaceId(): string | null {
    return this.d.storage.get().spaceId;
  }

  /** Storage writes from the engine only happen while it runs and the device is linked: a task still in flight when the person disconnects must not bring the state back. */
  private write(fn: Parameters<SyncStorage['set']>[0]): ReturnType<SyncStorage['set']> {
    const cur = this.d.storage.get();
    return this.running && cur.spaceId ? this.d.storage.set(fn) : cur;
  }

  isRunning(): boolean {
    return this.running;
  }

  // ---- lifecycle --------------------------------------------------------------------------------

  start(): void {
    if (this.running || !this.spaceId) return;
    this.running = true;
    this.prev = this.d.store.getState();
    this.offs.push(this.d.store.subscribe(() => this.onState()));
    this.offs.push(this.profiles.onLocalChange((list, at) => this.enqueue([profilesItem(list, at)])));
    this.offs.push(this.d.env.onWake(() => void this.cycle()));
    this.offs.push(this.d.env.onLeave(() => this.flush({ keepalive: true })));
    this.pollTimer = setInterval(() => {
      if (this.d.env.isVisible()) void this.cycle();
    }, POLL_MS);
    this.startRealtime();
    this.publish({ linked: true, phase: 'syncing' });
    void this.cycle();
  }

  stop(): void {
    this.running = false;
    for (const off of this.offs.splice(0)) off();
    for (const t of [this.pushTimer, this.retryTimer]) if (t) clearTimeout(t);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pushTimer = this.retryTimer = this.pollTimer = null;
    this.stopRealtime?.();
    this.stopRealtime = null;
  }

  /** After linking to a space: queue everything already on this device, then sync. */
  beginLink(opts: { profilesAt?: number } = {}): void {
    this.stop();
    const st = this.d.storage.get();
    const { list } = this.profiles.snapshot();
    // `profilesAt` (signing in on a device that has profiles of its own): the merged list counts as a change made now.
    const items = [...this.profiles.libraries().flatMap((l) => initialUpload(l.state, st.deviceName, l.id)), ...(list.length ? [profilesItem(list, opts.profilesAt ?? 0)] : [])];
    this.d.storage.set((s) => ({ ...s, cursors: {}, firstSyncDone: false, outbox: coalesce(s.outbox, items) }));
    this.attempts = 0;
    this.start();
  }

  private startRealtime(): void {
    const id = this.spaceId;
    if (!id || !this.d.realtime) return;
    this.stopRealtime = this.d.realtime(id, (table, row) => void this.enqueueTask(async () => this.applyRows(table, [row])));
  }

  setPlaying(videoId: string | null): void {
    this.playingId = videoId;
  }

  // ---- local changes -> outbox ------------------------------------------------------------------

  private onState(): void {
    const cur = this.d.store.getState();
    if (this.applying) {
      this.prev = cur;
      return;
    }
    const items = diffState(this.prev, cur, { now: this.d.now(), device: this.d.storage.get().deviceName, profileId: this.profiles.activeId() });
    this.prev = cur;
    if (items.length) this.enqueue(items);
  }

  /** Queues changes made outside the library (a profile's rows being deleted). */
  queue(items: OutboxItem[]): void {
    if (this.running) this.enqueue(items);
  }

  /** Another profile is now on screen: whatever changed before is already queued, so the swap itself must not read as an edit. */
  switchProfile(swap: () => void): void {
    this.applying = true;
    try {
      swap();
    } finally {
      this.applying = false;
      this.prev = this.d.store.getState();
    }
    // Rows of the profile that just opened were skipped while it was in the background: pull them again.
    this.write((s) => ({ ...s, cursors: {} }));
    void this.cycle();
  }

  /** Items for the main profile also tombstone the old un-prefixed row that is still on the server, so it can't come back. */
  private withLegacyTombstones(items: OutboxItem[]): { items: OutboxItem[]; cleared: string[] } {
    const known = new Set(this.d.storage.get().legacy ?? []);
    const extra: OutboxItem[] = [];
    const cleared: string[] = [];
    for (const i of items) {
      const old = legacyKeyOf(i);
      if (!old || !known.has(`${i.t}|${old}`)) continue;
      extra.push({ t: i.t, k: old, row: legacyTombstone(i.t, old), ts: i.ts });
      cleared.push(`${i.t}|${old}`);
    }
    return { items: extra.length ? [...items, ...extra] : items, cleared };
  }

  private enqueue(raw: OutboxItem[]): void {
    const { items, cleared } = this.withLegacyTombstones(raw);
    const st = this.write((s) => ({ ...s, outbox: coalesce(s.outbox, items), ...(cleared.length ? { legacy: (s.legacy ?? []).filter((x) => !cleared.includes(x)) } : {}) }));
    this.publish({ pending: st.outbox.length });
    this.schedulePush();
  }

  /** Progress goes out at most every 15 s; anything else after a short pause. */
  private schedulePush(): void {
    if (!this.running) return;
    const outbox = this.d.storage.get().outbox;
    if (!outbox.length) return;
    const onlyProgress = outbox.every((i) => i.t === 'watch_progress');
    const now = this.d.now();
    const due = now + (onlyProgress ? Math.max(PUSH_DEBOUNCE_MS, this.lastProgressPush + PROGRESS_PUSH_MS - now) : PUSH_DEBOUNCE_MS);
    if (this.pushTimer && this.pushDue <= due) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushDue = due;
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.enqueueTask(() => this.pushAll());
    }, Math.max(0, due - now));
  }

  /** Push right now (pause, seek, end, leaving the page). */
  flush(opts: { keepalive?: boolean } = {}): void {
    if (!this.running) return;
    if (opts.keepalive) return void this.pushKeepalive();
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = null;
    void this.enqueueTask(() => this.pushAll());
  }

  /** The page is closing: one fire-and-forget request per table, sent without waiting for anything else. */
  private pushKeepalive(): void {
    const spaceId = this.spaceId;
    if (!spaceId || !this.d.api.tokenFresh()) return;
    const items = this.d.storage.get().outbox.slice(0, KEEPALIVE_ITEMS);
    for (const t of TABLES) {
      const batch = items.filter((i) => i.t === t);
      if (!batch.length) continue;
      this.d.api
        .upsert(t, batch.map((i) => toRow(spaceId, i)), { keepalive: true })
        .then(() => this.removeSent(batch))
        .catch(() => {});
    }
  }

  // ---- the work queue ---------------------------------------------------------------------------

  /** One thing at a time, so a pull never lands in the middle of a push. */
  private enqueueTask<T>(fn: () => Promise<T>): Promise<T | undefined> {
    const run = this.chain.then(() => (this.running ? fn() : undefined)).catch(() => undefined) as Promise<T | undefined>;
    this.chain = run;
    return run;
  }

  /** Pull then push, with status and retry handling. */
  cycle(): Promise<void> {
    return this.enqueueTask(async () => {
      if (!this.spaceId) return;
      if (!this.d.env.isOnline()) return this.settle(new SyncHttpError(0, 'offline'));
      this.publish({ phase: 'syncing' });
      try {
        await this.pullAll();
        await this.pushAll(true);
        this.succeed();
      } catch (e) {
        this.settle(e);
      }
    }) as Promise<void>;
  }

  private succeed(): void {
    this.attempts = 0;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const st = this.d.storage.get();
    let toast: string | null = null;
    if (!st.firstSyncDone) {
      this.write((s) => ({ ...s, firstSyncDone: true }));
      if (this.firstApplied > 0) toast = `Synced ${this.firstApplied} item${this.firstApplied === 1 ? '' : 's'} from ${this.firstFrom ?? 'another device'}`;
      this.firstApplied = 0;
      this.firstFrom = null;
    }
    this.publish({ phase: 'idle', lastSyncAt: this.d.now(), pending: st.outbox.length, ...(toast ? { toast } : {}) });
  }

  private settle(e: unknown): void {
    const status = errStatus(e);
    this.publish({ phase: status === 0 ? 'offline' : 'error', pending: this.d.storage.get().outbox.length });
    if (status === 401 && e instanceof SyncHttpError && e.message === 'auth_lost') return; // needs a new code: retrying cannot help
    if (this.retryTimer || !this.running) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.cycle();
    }, retryDelay(++this.attempts, this.d.random));
  }

  private publish(patch: Parameters<typeof setSyncStatus>[0]): void {
    setSyncStatus({ deviceName: this.d.storage.get().deviceName, ...patch });
  }

  // ---- push -------------------------------------------------------------------------------------

  private removeSent(sent: OutboxItem[]): void {
    const st = this.write((s) => ({
      ...s,
      // A newer change to the same key stays queued.
      outbox: s.outbox.filter((o) => !sent.some((x) => x.t === o.t && x.k === o.k && x.ts === o.ts)),
    }));
    this.publish({ pending: st.outbox.length });
  }

  private async pushAll(rethrow = false): Promise<void> {
    const spaceId = this.spaceId;
    if (!spaceId) return;
    try {
      for (let guard = 0; guard < 1000; guard++) {
        const outbox = this.d.storage.get().outbox;
        if (!outbox.length) break;
        const t = outbox[0]!.t;
        const batch = outbox.filter((i) => i.t === t).slice(0, PUSH_BATCH);
        await this.pushBatch(spaceId, t, batch);
        if (t === 'watch_progress') this.lastProgressPush = this.d.now();
      }
      if (!rethrow) this.succeed();
    } catch (e) {
      if (!rethrow) this.settle(e);
      else throw e;
    }
  }

  private async pushBatch(spaceId: string, t: Table, batch: OutboxItem[]): Promise<void> {
    try {
      await this.d.api.upsert(t, batch.map((i) => toRow(spaceId, i)));
      this.removeSent(batch);
    } catch (e) {
      if (!isPoison(errStatus(e))) throw e;
      if (batch.length === 1) {
        // This row can never be accepted: drop it so it doesn't block the rest.
        this.dropped += 1;
        this.removeSent(batch);
        return;
      }
      for (const one of batch) await this.pushBatch(spaceId, t, [one]);
    }
  }

  // ---- pull -------------------------------------------------------------------------------------

  private async pullAll(): Promise<void> {
    const spaceId = this.spaceId;
    if (!spaceId) return;
    for (const t of TABLES) {
      for (let page = 0; page < 100; page++) {
        const cursor = this.d.storage.get().cursors[t] ?? null;
        const rows = await this.d.api.pull(t, spaceId, cursor, PAGE_SIZE);
        if (this.spaceId !== spaceId) return; // left or switched while waiting
        if (rows.length) this.applyRows(t, rows);
        const last = rows[rows.length - 1]?.updated_at;
        if (last && last !== cursor) this.write((s) => ({ ...s, cursors: { ...s.cursors, [t]: last } }));
        if (rows.length < PAGE_SIZE || !last || last === cursor) break;
      }
    }
  }

  private applyProfilesRows(rows: RemoteRow[], pending: Map<string, number>): void {
    const pick = pickProfilesRow(rows, { selfUid: this.d.api.userId(), pendingTs: pending.get(`settings|${PROFILES_ROW_KEY}`) });
    if (!pick) return;
    if (pick.supersedes) {
      const next = this.write((s) => ({ ...s, outbox: s.outbox.filter((o) => !(o.t === 'settings' && o.k === PROFILES_ROW_KEY)) }));
      this.publish({ pending: next.outbox.length });
    }
    this.profiles.apply(pick.list, pick.at);
  }

  /** Remembers old-style rows seen on the server (live ones), so the main profile's writes can tombstone them. */
  private learnLegacy(t: Table, rows: RemoteRow[]): void {
    const seen: string[] = [];
    for (const r of rows) {
      if (r.deleted) continue;
      const raw = t === 'watch_progress' ? r.item_key : t === 'settings' ? r.key : r.title_id;
      const p = typeof raw === 'string' ? parseKey(t, raw) : null;
      if (p?.kind === 'row' && p.legacy) seen.push(`${t}|${p.key}`);
    }
    if (!seen.length) return;
    this.write((s) => ({ ...s, legacy: [...new Set([...(s.legacy ?? []), ...seen])].slice(-5000) }));
  }

  private applyRows(t: Table, rowsIn: RemoteRow[]): void {
    const st = this.d.storage.get();
    const pending = new Map<string, number>(st.outbox.map((o) => [`${o.t}|${o.k}`, o.ts]));
    let rows = rowsIn;
    if (t === 'settings') {
      this.applyProfilesRows(rows, pending);
      rows = rows.filter((r) => r.key !== PROFILES_ROW_KEY);
    }
    this.learnLegacy(t, rows);
    let result: ReturnType<typeof applyRemoteRows> | null = null;
    this.applying = true;
    try {
      this.d.store.update((s) => {
        result = applyRemoteRows(s, t, rows, { profileId: this.profiles.activeId(), selfUid: this.d.api.userId(), pendingTs: (tt, k) => pending.get(`${tt}|${k}`), playingId: this.playingId });
        return result.state;
      });
    } finally {
      this.applying = false;
      this.prev = this.d.store.getState();
    }
    const r = result as ReturnType<typeof applyRemoteRows> | null;
    if (!r) return;
    if (r.superseded.length) {
      const gone = new Set(r.superseded.map((k) => `${t}|${k}`));
      const next = this.write((s) => ({ ...s, outbox: s.outbox.filter((o) => !gone.has(`${o.t}|${o.k}`)) }));
      this.publish({ pending: next.outbox.length });
    }
    if (!st.firstSyncDone) {
      this.firstApplied += r.changed;
      if (r.from) this.firstFrom = r.from;
    }
  }
}

/** The old un-prefixed key of an item the main profile writes, if it has one. */
function legacyKeyOf(i: OutboxItem): string | null {
  if (i.k === PROFILES_ROW_KEY) return null;
  if (i.t === 'settings') return i.k.startsWith(`pref:${MAIN_ID}:`) ? i.k.slice(`pref:${MAIN_ID}:`.length) : null;
  return i.k.startsWith(`${MAIN_ID}~`) ? i.k.slice(MAIN_ID.length + 1) : null;
}

/** Newer changes replace older ones for the same row. */
export function coalesce(outbox: OutboxItem[], items: OutboxItem[]): OutboxItem[] {
  const map = new Map<string, OutboxItem>(outbox.map((o) => [`${o.t}|${o.k}`, o]));
  for (const i of items) {
    const key = `${i.t}|${i.k}`;
    const old = map.get(key);
    if (!old || i.ts >= old.ts) map.set(key, i);
  }
  return [...map.values()];
}

function toRow(spaceId: string, i: OutboxItem): Record<string, unknown> {
  return { ...i.row, space_id: spaceId, client_ts: new Date(i.ts).toISOString() };
}
