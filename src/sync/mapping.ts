/** Local library state <-> sync rows. Pure.
 *
 * Synced: watch progress (+ the series' "current episode" pointer), My List, ratings, and the preferences in
 * SYNCED_SETTING_KEYS. Whether a title is finished travels in watch_progress.finished, so the `watched` table is unused.
 * Per device (never sent): see DEVICE_SETTING_KEYS.
 */
import { DEFAULT_SETTINGS, initialState, type LibraryState, type Snapshot } from '../state/library';
import type { Rating } from '../lib/recommend';
import { MAIN_ID, type Profile, type StoredProfile } from '../profiles/types';
import { prefKey, prefixKey, PROFILES_ROW_KEY, SYNCED_SETTING_KEYS } from './keys';
import type { OutboxItem } from './types';


export { DEVICE_SETTING_KEYS } from '../state/library';
export { SYNCED_SETTING_KEYS, isSyncedSetting, type SyncedSettingKey } from './keys';


const MAX_META_BYTES = 7000;
const CONTENT_CHARS = 120;

export const progressKey = (videoId: string): string => `v:${videoId}`;
export const videoIdOf = (itemKey: string): string => (itemKey.startsWith('v:') ? itemKey.slice(2) : itemKey);

const SCORE: Record<Rating, number> = { dislike: 1, like: 8, love: 10 };
export const ratingToScore = (r: Rating): number => SCORE[r];
export const scoreToRating = (n: number): Rating => (n >= 9 ? 'love' : n >= 5 ? 'like' : 'dislike');

const slim = (s: Snapshot | undefined, content = CONTENT_CHARS): Snapshot | undefined =>
  s ? { ...s, enContent: s.enContent.slice(0, content), arContent: s.arContent.slice(0, content) } : undefined;

/** Keeps a meta object under the server's 8 KB limit by dropping the synopses, then the extras. */
export function fitMeta(metaIn: object): object {
  const meta = metaIn as Record<string, unknown>;
  if (JSON.stringify(meta).length <= MAX_META_BYTES) return meta;
  const strip = (v: unknown): unknown =>
    v && typeof v === 'object' && 'enContent' in (v as object) ? { ...(v as object), enContent: '', arContent: '', stars: [] } : v;
  const lean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) lean[k] = strip(v);
  return JSON.stringify(lean).length <= MAX_META_BYTES ? lean : { dev: meta.dev };
}

export interface ProgressMeta {
  sid: string | null;
  s: number | null;
  e: number | null;
  snap?: Snapshot;
  ssnap?: Snapshot;
  nsnap?: Snapshot;
  /** The series pointer this write set: the episode to continue with and whether it is "up next". */
  ptr: { id: string; up: boolean } | null;
  dev: string;
}

export function progressRow(s: LibraryState, id: string, device: string, profileId: string = MAIN_ID): Record<string, unknown> {
  const p = s.progress[id]!;
  const sid = p.seriesId;
  const pointer = sid ? s.seriesLast[sid] : undefined;
  const own = pointer && pointer.updatedAt === p.updatedAt ? pointer : undefined;
  const meta: ProgressMeta = {
    sid,
    s: p.season,
    e: p.episode,
    snap: slim(s.snapshots[id]),
    ssnap: sid ? slim(s.snapshots[sid]) : undefined,
    nsnap: own && own.episodeId !== id ? slim(s.snapshots[own.episodeId]) : undefined,
    ptr: own ? { id: own.episodeId, up: own.upNext } : null,
    dev: device,
  };
  return {
    item_key: prefixKey(profileId, progressKey(id)),
    title_id: sid ?? id,
    position_ms: Math.round(p.position * 1000),
    duration_ms: Math.round(p.duration * 1000),
    finished: p.completed,
    deleted: false,
    meta: fitMeta(meta),
  };
}

export interface DiffCtx {
  /** The profile whose library is being compared: its rows are keyed with this id. */
  profileId: string;
  now: number;
  device: string;
  /** First upload after linking: items without their own time get 0, so anything already on the server wins. */
  initial?: boolean;
}

/** What changed between two library states, as outbox items. Compares by identity, so it is cheap on every update. */
export function diffState(prev: LibraryState, next: LibraryState, ctx: DiffCtx): OutboxItem[] {
  const out: OutboxItem[] = [];
  const at = ctx.initial ? 0 : ctx.now;
  const pid = ctx.profileId;

  if (prev.progress !== next.progress) {
    for (const [id, p] of Object.entries(next.progress)) {
      const before = prev.progress[id];
      if (before !== p) {
        const k = prefixKey(pid, progressKey(id));
        out.push({ t: 'watch_progress', k, row: progressRow(next, id, ctx.device, pid), ts: p.updatedAt });
      }
    }
    for (const id of Object.keys(prev.progress)) {
      if (!next.progress[id]) {
        const k = prefixKey(pid, progressKey(id));
        out.push({ t: 'watch_progress', k, row: { item_key: k, title_id: prev.progress[id]!.seriesId ?? id, position_ms: 0, duration_ms: 0, finished: false, deleted: true, meta: {} }, ts: ctx.now });
      }
    }
  }

  if (prev.myList !== next.myList) {
    const before = new Set(prev.myList);
    const after = new Set(next.myList);
    for (const id of next.myList) {
      if (!before.has(id)) out.push({ t: 'my_list', k: prefixKey(pid, id), row: { title_id: prefixKey(pid, id), deleted: false, meta: fitMeta({ ...(slim(next.snapshots[id]) ?? {}), dev: ctx.device }) }, ts: at });
    }
    for (const id of prev.myList) {
      if (!after.has(id)) out.push({ t: 'my_list', k: prefixKey(pid, id), row: { title_id: prefixKey(pid, id), deleted: true, meta: {} }, ts: ctx.now });
    }
  }

  if (prev.ratings !== next.ratings) {
    for (const [id, r] of Object.entries(next.ratings)) {
      if (prev.ratings[id] !== r) out.push({ t: 'ratings', k: prefixKey(pid, id), row: { title_id: prefixKey(pid, id), rating: ratingToScore(r), deleted: false }, ts: at });
    }
    for (const id of Object.keys(prev.ratings)) {
      if (!(id in next.ratings)) out.push({ t: 'ratings', k: prefixKey(pid, id), row: { title_id: prefixKey(pid, id), rating: 0, deleted: true }, ts: ctx.now });
    }
  }

  if (prev.settings !== next.settings) {
    for (const key of SYNCED_SETTING_KEYS) {
      if (prev.settings[key] === next.settings[key]) continue;
      // First upload: a setting still at its default says nothing, so it must not overwrite what another device chose.
      if (ctx.initial && next.settings[key] === DEFAULT_SETTINGS[key]) continue;
      const k = prefKey(pid, key);
      out.push({ t: 'settings', k, row: { key: k, value: next.settings[key], deleted: false }, ts: at });
    }
  }
  return out;
}

/** Everything worth uploading from an existing library when a device links. */
export const initialUpload = (s: LibraryState, device: string, profileId: string = MAIN_ID): OutboxItem[] =>
  diffState(initialState(), s, { now: 0, device, initial: true, profileId });

/** The profile list as one settings row. `ts` is when the list last changed (0 on the first upload: the server's copy wins). */
export const profilesItem = (list: StoredProfile[], ts: number): OutboxItem => ({ t: 'settings', k: PROFILES_ROW_KEY, row: { key: PROFILES_ROW_KEY, value: list, deleted: false }, ts });

/** Deletes every row a library has on the server (when a profile is deleted with "also delete its synced data"). */
export function purgeItems(lib: LibraryState, profile: Pick<Profile, 'id'>, now: number): OutboxItem[] {
  const pid = profile.id;
  const out = diffState(lib, initialState(), { now, device: '', profileId: pid }).filter((i) => i.t !== 'settings');
  for (const key of SYNCED_SETTING_KEYS) {
    const k = prefKey(pid, key);
    out.push({ t: 'settings', k, row: { key: k, value: null, deleted: true }, ts: now });
  }
  return out;
}
