/** Sync row keys per profile. Pure.
 *
 * Every per-profile row is keyed '<profileId>~<oldKey>' (settings: 'pref:<profileId>:<name>'). Keys without the prefix
 * were written before profiles existed and belong to the profile 'main'. The profile list itself is one settings row.
 */
import { MAIN_ID } from '../profiles/types';
import type { Settings } from '../state/library';
import type { Table } from './types';

/** Preferences that follow the person from device to device (per profile). */
export const SYNCED_SETTING_KEYS = ['level', 'titleLang', 'familySkips', 'autoplayNext', 'subtitleLang', 'subtitleSize', 'subtitleColor', 'subtitleBackground', 'subtitleOffset'] as const satisfies readonly (keyof Settings)[];
export type SyncedSettingKey = (typeof SYNCED_SETTING_KEYS)[number];
export const isSyncedSetting = (k: string): k is SyncedSettingKey => (SYNCED_SETTING_KEYS as readonly string[]).includes(k);

export const PROFILES_ROW_KEY = 'profiles';
const ID_RE = /^[a-z0-9]{1,16}$/;

export const prefixKey = (profileId: string, key: string): string => `${profileId}~${key}`;
export const prefKey = (profileId: string, name: string): string => `pref:${profileId}:${name}`;

/** The key a row has in the outbox and in `pendingTs` lookups. */
export const canonicalKey = (table: Table, profileId: string, key: string): string => (table === 'settings' ? prefKey(profileId, key) : prefixKey(profileId, key));

export type ParsedKey = { kind: 'profiles' } | { kind: 'row'; profile: string; key: string; legacy: boolean };

/** What a remote row's key means, or null when it is none of ours. */
export function parseKey(table: Table, raw: string): ParsedKey | null {
  if (table === 'settings') {
    if (raw === PROFILES_ROW_KEY) return { kind: 'profiles' };
    const m = /^pref:([a-z0-9]{1,16}):(.+)$/.exec(raw);
    if (m) return { kind: 'row', profile: m[1]!, key: m[2]!, legacy: false };
    return isSyncedSetting(raw) ? { kind: 'row', profile: MAIN_ID, key: raw, legacy: true } : null;
  }
  const i = raw.indexOf('~');
  if (i < 0) return { kind: 'row', profile: MAIN_ID, key: raw, legacy: true };
  const profile = raw.slice(0, i);
  const key = raw.slice(i + 1);
  return ID_RE.test(profile) && key ? { kind: 'row', profile, key, legacy: false } : null;
}

/** The row a main-profile write also leaves behind for its old, un-prefixed key, so old rows can never come back. */
export function legacyTombstone(table: Table, key: string): Record<string, unknown> {
  switch (table) {
    case 'watch_progress':
      return { item_key: key, title_id: key.replace(/^v:/, ''), position_ms: 0, duration_ms: 0, finished: false, deleted: true, meta: {} };
    case 'ratings':
      return { title_id: key, rating: 0, deleted: true };
    case 'my_list':
      return { title_id: key, deleted: true, meta: {} };
    case 'settings':
      return { key, value: null, deleted: true };
  }
}
