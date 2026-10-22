/** Profile list rules. Pure. */
import { AVATARS, COLOR_COUNT, MAIN_ID, MAX_PROFILES, NAME_MAX, isAvatar, isTombstone, type PinRecord, type Profile, type StoredProfile } from './types';

/** Old tombstones are dropped past this many, oldest first (the synced row must stay under 8 KB). */
export const MAX_TOMBSTONES = 24;

export const defaultList = (now: number): StoredProfile[] => [{ id: MAIN_ID, name: 'Me', color: 0, avatar: 'fox', kids: false, pin: null, order: 0, created: now }];

const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function parsePin(v: unknown): PinRecord | null {
  if (!isRec(v)) return null;
  const { salt, iter, hash } = v;
  return typeof salt === 'string' && typeof hash === 'string' && typeof iter === 'number' && Number.isInteger(iter) && iter > 0 ? { salt, iter, hash } : null;
}

export const cleanName = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
const validId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9]{1,16}$/.test(v);

/** Reads a list from storage or from the server: anything malformed is dropped, never trusted. */
export function sanitizeList(raw: unknown): StoredProfile[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: StoredProfile[] = [];
  for (const r of raw) {
    if (!isRec(r) || !validId(r.id) || seen.has(r.id)) continue;
    seen.add(r.id);
    if (r.deleted === true) {
      out.push({ id: r.id, deleted: true });
      continue;
    }
    const name = typeof r.name === 'string' ? cleanName(r.name) : '';
    if (!name) continue;
    out.push({
      id: r.id,
      name,
      color: typeof r.color === 'number' && Number.isInteger(r.color) && r.color >= 0 && r.color < COLOR_COUNT ? r.color : 0,
      avatar: isAvatar(r.avatar) ? r.avatar : AVATARS[0],
      kids: r.kids === true,
      pin: parsePin(r.pin),
      order: typeof r.order === 'number' && Number.isFinite(r.order) ? Math.trunc(r.order) : 0,
      created: typeof r.created === 'number' && Number.isFinite(r.created) ? r.created : 0,
    });
  }
  // The most recent tombstones only.
  const dead = out.filter(isTombstone);
  if (dead.length <= MAX_TOMBSTONES) return out;
  const drop = new Set(dead.slice(0, dead.length - MAX_TOMBSTONES).map((d) => d.id));
  return out.filter((p) => !drop.has(p.id));
}

export const liveProfiles = (list: StoredProfile[]): Profile[] =>
  list.filter((p): p is Profile => !isTombstone(p)).sort((a, b) => a.order - b.order || a.created - b.created);

export const canAdd = (list: StoredProfile[]): boolean => liveProfiles(list).length < MAX_PROFILES;

/** Eight random lowercase letters and digits, never 'main' and never an id already used (even a deleted one). */
export function newProfileId(list: StoredProfile[], random: () => number = Math.random): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const taken = (id: string) => id === MAIN_ID || list.some((p) => p.id === id);
  let id = '';
  for (let tries = 0; tries < 50; tries++) {
    id = '';
    for (let i = 0; i < 8; i++) id += chars[Math.floor(random() * chars.length) % chars.length];
    if (!taken(id)) return id;
  }
  // A stuck random source (tests): walk forward from the last candidate until one is free.
  for (let n = 1; ; n++) {
    const next = id.slice(0, 8 - String(n).length) + String(n);
    if (!taken(next)) return next;
  }
}

export interface ProfileInput {
  name: string;
  color: number;
  avatar: string;
  kids: boolean;
}

export type EditError = 'name' | 'color' | 'avatar' | 'max' | 'last' | 'missing';

function validateInput(i: ProfileInput): EditError | null {
  if (!cleanName(i.name)) return 'name';
  if (!Number.isInteger(i.color) || i.color < 0 || i.color >= COLOR_COUNT) return 'color';
  if (!isAvatar(i.avatar)) return 'avatar';
  return null;
}

export function addProfile(list: StoredProfile[], input: ProfileInput, now: number, random?: () => number): { list: StoredProfile[]; profile: Profile } | { error: EditError } {
  if (!canAdd(list)) return { error: 'max' };
  const bad = validateInput(input);
  if (bad) return { error: bad };
  const live = liveProfiles(list);
  const profile: Profile = {
    id: newProfileId(list, random),
    name: cleanName(input.name),
    color: input.color,
    avatar: input.avatar as Profile['avatar'],
    kids: input.kids,
    pin: null,
    order: live.length ? Math.max(...live.map((p) => p.order)) + 1 : 0,
    created: now,
  };
  return { list: [...list, profile], profile };
}

export function editProfile(list: StoredProfile[], id: string, patch: Partial<ProfileInput> & { pin?: PinRecord | null }): { list: StoredProfile[] } | { error: EditError } {
  const cur = list.find((p) => p.id === id);
  if (!cur || isTombstone(cur)) return { error: 'missing' };
  const merged: Profile = { ...cur, ...(patch.name !== undefined ? { name: cleanName(patch.name) } : {}), ...(patch.color !== undefined ? { color: patch.color } : {}), ...(patch.avatar !== undefined ? { avatar: patch.avatar as Profile['avatar'] } : {}), ...(patch.kids !== undefined ? { kids: patch.kids } : {}), ...(patch.pin !== undefined ? { pin: patch.pin } : {}) };
  const bad = validateInput(merged);
  if (bad) return { error: bad };
  return { list: list.map((p) => (p.id === id ? merged : p)) };
}

/** Deleting leaves a tombstone. The last profile cannot be deleted. */
export function deleteProfile(list: StoredProfile[], id: string): { list: StoredProfile[] } | { error: EditError } {
  const cur = list.find((p) => p.id === id);
  if (!cur || isTombstone(cur)) return { error: 'missing' };
  if (liveProfiles(list).length <= 1) return { error: 'last' };
  return { list: sanitizeList(list.map((p) => (p.id === id ? { id, deleted: true as const } : p))) };
}

// ---- who may do what --------------------------------------------------------------------------

/** Adult profiles that have a PIN: any of them can open management or leave a Kids profile. */
export const guardians = (list: StoredProfile[]): Profile[] => liveProfiles(list).filter((p) => !p.kids && p.pin);
export const needsGuardianPin = (list: StoredProfile[]): boolean => guardians(list).length > 0;

export interface Capabilities {
  settings: boolean;
  sync: boolean;
  reset: boolean;
  manageProfiles: boolean;
}

/** What a profile may reach. A Kids profile gets none of the controls. */
export const capabilities = (p: Pick<Profile, 'kids'> | null): Capabilities => {
  const all = !p?.kids;
  return { settings: all, sync: all, reset: all, manageProfiles: all };
};

export interface StartupPlan {
  /** Show "Who's watching?" */
  picker: boolean;
  /** The profile to open (when no picker). */
  profileId: string;
}

/** The profile this device opens with: the picker when there are several and the person wants it, or when the last one has a PIN. */
export function startupPlan(list: StoredProfile[], lastId: string | null, askOnStart: boolean): StartupPlan {
  const live = liveProfiles(list);
  const last = live.find((p) => p.id === lastId) ?? live.find((p) => p.id === MAIN_ID) ?? live[0];
  const profileId = last?.id ?? MAIN_ID;
  return { picker: (live.length > 1 && askOnStart) || !!last?.pin, profileId };
}
