/** Applying rows from the server to the library. Pure.
 *
 * Rule: the newest change wins. A row from the server replaces local data unless this device has a newer change still
 * waiting in the outbox (compared by the time the change was made: client_ts, else the server's updated_at).
 * Progress additionally never moves under a video that is playing on this device, and a device ignores its own echoes.
 */
import { DEFAULT_SETTINGS, type LibraryState, type ProgressEntry, type Snapshot } from '../state/library';
import { canonicalKey, parseKey } from './keys';
import { isSyncedSetting, scoreToRating, videoIdOf, type ProgressMeta } from './mapping';
import type { RemoteRow, Table } from './types';

export interface MergeCtx {
  /** The profile on screen: rows of other profiles are not applied (they are pulled again when that profile opens). */
  profileId: string;
  /** This device's account id: rows it wrote itself are skipped. */
  selfUid: string | null;
  /** Time (ms) of this device's queued change for the key, if any. The key is the prefixed one used in the outbox. */
  pendingTs: (table: Table, key: string) => number | undefined;
  /** The video playing here right now. */
  playingId: string | null;
}

export interface MergeResult {
  state: LibraryState;
  /** Rows that changed something. */
  changed: number;
  /** Keys whose queued local change lost to the server's newer row. */
  superseded: string[];
  /** Device name of the newest changed row that carried one. */
  from: string | null;
}

export const rowTs = (r: RemoteRow): number => {
  const t = Date.parse(String(r.client_ts ?? r.updated_at));
  return Number.isFinite(t) ? t : 0;
};
const serverMs = (r: RemoteRow): number => {
  const t = Date.parse(r.updated_at);
  return Number.isFinite(t) ? t : 0;
};

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const snap = (v: unknown): Snapshot | undefined => (v && typeof v === 'object' && typeof (v as Snapshot).id === 'string' ? (v as Snapshot) : undefined);

function keyOf(table: Table, r: RemoteRow): string | null {
  return str(table === 'watch_progress' ? r.item_key : table === 'settings' ? r.key : r.title_id);
}

function withSnapshots(s: LibraryState, ...snaps: (Snapshot | undefined)[]): Record<string, Snapshot> {
  let out = s.snapshots;
  for (const sn of snaps) {
    if (sn && !out[sn.id]) out = { ...out, [sn.id]: sn };
  }
  return out;
}

function applyProgress(s: LibraryState, r: RemoteRow, key: string): LibraryState {
  const id = videoIdOf(key);
  const meta = rec(r.meta) as Partial<ProgressMeta> & Record<string, unknown>;
  const sid = str(meta.sid) ?? (str(r.title_id) !== id ? str(r.title_id) : null);

  if (r.deleted) {
    if (!s.progress[id]) return s;
    const progress = { ...s.progress };
    delete progress[id];
    let seriesLast = s.seriesLast;
    for (const [k, ptr] of Object.entries(s.seriesLast)) {
      if (ptr.episodeId === id) {
        if (seriesLast === s.seriesLast) seriesLast = { ...s.seriesLast };
        delete seriesLast[k];
      }
    }
    return { ...s, progress, seriesLast };
  }

  const at = serverMs(r);
  const entry: ProgressEntry = {
    id,
    seriesId: sid,
    season: typeof meta.s === 'number' ? meta.s : null,
    episode: typeof meta.e === 'number' ? meta.e : null,
    position: num(r.position_ms) / 1000,
    duration: num(r.duration_ms) / 1000,
    completed: r.finished === true,
    updatedAt: at,
    from: str(meta.dev) ?? undefined,
  };
  const old = s.progress[id];
  let seriesLast = s.seriesLast;
  if (sid) {
    const ptr = meta.ptr;
    const current = s.seriesLast[sid];
    if (ptr && typeof ptr.id === 'string') {
      if (!current || current.updatedAt <= at) {
        if (!current || current.episodeId !== ptr.id || current.upNext !== ptr.up || current.updatedAt !== at) {
          seriesLast = { ...s.seriesLast, [sid]: { episodeId: ptr.id, upNext: ptr.up === true, updatedAt: at } };
        }
      }
    } else if (entry.completed && current && current.episodeId === id) {
      seriesLast = { ...s.seriesLast };
      delete seriesLast[sid];
    }
  }
  const same =
    old &&
    old.position === entry.position &&
    old.duration === entry.duration &&
    old.completed === entry.completed &&
    old.seriesId === entry.seriesId &&
    old.updatedAt === entry.updatedAt;
  if (same && seriesLast === s.seriesLast) return s;
  const snapshots = withSnapshots(s, snap(meta.snap), snap(meta.ssnap), snap(meta.nsnap));
  return { ...s, progress: same ? s.progress : { ...s.progress, [id]: entry }, seriesLast, snapshots };
}

function applyMyList(s: LibraryState, r: RemoteRow, id: string): LibraryState {
  const has = s.myList.includes(id);
  if (r.deleted) return has ? { ...s, myList: s.myList.filter((x) => x !== id) } : s;
  if (has) return s;
  return { ...s, myList: [id, ...s.myList], snapshots: withSnapshots(s, snap(rec(r.meta))) };
}

function applyRating(s: LibraryState, r: RemoteRow, id: string): LibraryState {
  if (r.deleted) {
    if (!(id in s.ratings)) return s;
    const ratings = { ...s.ratings };
    delete ratings[id];
    return { ...s, ratings };
  }
  const rating = scoreToRating(num(r.rating));
  return s.ratings[id] === rating ? s : { ...s, ratings: { ...s.ratings, [id]: rating } };
}

function validSetting(key: string, value: unknown): boolean {
  if (!isSyncedSetting(key)) return false;
  if (typeof value !== typeof DEFAULT_SETTINGS[key]) return false;
  if (key === 'level') return value === 0 || value === 2 || value === 3;
  if (key === 'subtitleOffset') return Number.isFinite(value as number) && Math.abs(value as number) <= 120;
  return true;
}

function applySetting(s: LibraryState, r: RemoteRow, key: string): LibraryState {
  if (r.deleted || !validSetting(key, r.value) || s.settings[key as keyof typeof s.settings] === r.value) return s;
  return { ...s, settings: { ...s.settings, [key]: r.value } };
}

/** Rows must arrive oldest first. */
export function applyRemoteRows(state: LibraryState, table: Table, rows: RemoteRow[], ctx: MergeCtx): MergeResult {
  let s = state;
  let changed = 0;
  let from: string | null = null;
  const superseded: string[] = [];
  for (const r of rows) {
    const raw = keyOf(table, r);
    if (!raw) continue;
    const parsed = parseKey(table, raw);
    if (!parsed || parsed.kind !== 'row' || parsed.profile !== ctx.profileId) continue;
    // A deleted old-style row is only the marker left by a migrated device; it must not erase the prefixed row.
    if (parsed.legacy && r.deleted) continue;
    const key = parsed.key;
    if (ctx.selfUid && r.updated_by === ctx.selfUid) continue;
    const pending = ctx.pendingTs(table, canonicalKey(table, parsed.profile, key));
    if (pending !== undefined) {
      if (pending > rowTs(r)) continue;
      superseded.push(canonicalKey(table, parsed.profile, key));
    }
    if (table === 'watch_progress' && ctx.playingId && videoIdOf(key) === ctx.playingId) continue;
    const before = s;
    s = table === 'watch_progress' ? applyProgress(s, r, key) : table === 'my_list' ? applyMyList(s, r, key) : table === 'ratings' ? applyRating(s, r, key) : applySetting(s, r, key);
    if (s !== before) {
      changed += 1;
      const dev = str(rec(r.meta).dev);
      if (dev) from = dev;
    }
  }
  return { state: s, changed, superseded, from };
}
