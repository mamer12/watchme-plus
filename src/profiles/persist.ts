/** What profiles keep in localStorage. The first (legacy) profile 'main' keeps the library's original key, so an existing
 * library becomes 'main' without being rewritten. Pure helpers over an injectable KV. */
import { readJson, writeJson, type KV } from '../lib/storage';
import { hydrate, pickDevice, type DeviceSettings, type LibraryState } from '../state/library';
import { enforceKids } from './kids';
import { defaultList, sanitizeList } from './logic';
import { MAIN_ID, isTombstone, type Profile, type StoredProfile } from './types';

export const PROFILES_KEY = 'wmp:profiles:v1';
export const LIBRARY_KEY = 'wmp:state:v1';
export const DEVICE_KEY = 'wmp:device:v1';
export const LOCK_KEY = 'wmp:pinlock:v1';

export const libraryKey = (id: string): string => (id === MAIN_ID ? LIBRARY_KEY : `${LIBRARY_KEY}:${id}`);

export interface PersistedProfiles {
  v: 1;
  list: StoredProfile[];
  /** The profile this device used last. */
  lastId: string | null;
  /** Show "Who's watching?" on every start (device setting). */
  askOnStart: boolean;
  /** When the list last changed: the time sync uses to decide which copy is newer. */
  updatedAt: number;
}

export function loadProfiles(kv: KV | null | undefined, now: number): PersistedProfiles {
  const raw = readJson<Partial<PersistedProfiles>>(PROFILES_KEY, kv);
  const list = sanitizeList(raw?.list);
  if (!raw || raw.v !== 1 || !list.some((p) => !('deleted' in p))) {
    // First run (or damaged): 'main' takes over whatever library is already here.
    return { v: 1, list: defaultList(now), lastId: MAIN_ID, askOnStart: true, updatedAt: 0 };
  }
  return { v: 1, list, lastId: typeof raw.lastId === 'string' ? raw.lastId : null, askOnStart: raw.askOnStart !== false, updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0 };
}

export const saveProfiles = (p: PersistedProfiles, kv: KV | null | undefined): boolean => writeJson(PROFILES_KEY, p, undefined, kv);

/** A profile's library as saved, with this device's own settings laid over it. The first time, the device settings are taken
 * from the library that was already here (the migration), so nothing changes for a person who had one before profiles. */
export function loadLibraryFor(id: string, kids: boolean, kv?: KV | null): { state: LibraryState; device: DeviceSettings } {
  const lib = hydrate(readJson(libraryKey(id), kv));
  const saved = readJson<Partial<DeviceSettings>>(DEVICE_KEY, kv);
  const device: DeviceSettings = { ...pickDevice(lib.settings), ...(saved && typeof saved === 'object' ? saved : {}) };
  const state: LibraryState = { ...lib, settings: { ...lib.settings, ...device } };
  return { state: kids ? enforceKids(state) : state, device };
}

/** Which profile this device starts in, and whether it is a Kids one. */
export function bootProfile(kv?: KV | null, now: number = Date.now()): { id: string; kids: boolean } {
  const p = loadProfiles(kv, now);
  const live = p.list.filter((x): x is Profile => !isTombstone(x));
  const cur = live.find((x) => x.id === p.lastId) ?? live.find((x) => x.id === MAIN_ID) ?? live[0];
  return { id: cur?.id ?? MAIN_ID, kids: !!cur?.kids };
}
