import { describe, expect, it } from 'vitest';
import { resetSite } from '../lib/resetSite';
import { memoryStore, readJson, writeJson, type KV } from '../lib/storage';
import { initialState, pickDevice, toggleMyList, updateSettings, type LibraryState } from '../state/library';
import { movie } from '../sync/helpers';
import { enforceKids, KIDS_LEVEL } from './kids';
import { addProfile, capabilities, deleteProfile, guardians, liveProfiles, newProfileId, sanitizeList, startupPlan } from './logic';
import { bootProfile, DEVICE_KEY, LIBRARY_KEY, libraryKey, loadLibraryFor, loadProfiles, LOCK_KEY, PROFILES_KEY } from './persist';
import { afterAttempt, constantTimeEqual, fromBase64, hashPin, isValidPin, LOCK_MS, verifyPin, type PinCrypto } from './pin';
import { checkPin } from './pinGate';
import { ProfilesStore, type LibraryHost } from './store';
import { AVATARS, MAIN_ID, MAX_PROFILES, type Profile } from './types';

/** A cheap deterministic PBKDF2 stand-in so most tests don't pay for 20000 iterations. */
const fakeCrypto: PinCrypto = {
  randomBytes: (n) => Uint8Array.from({ length: n }, (_, i) => i + 1),
  pbkdf2: async (pin, salt, iter) => Uint8Array.from({ length: 32 }, (_, i) => (pin.charCodeAt(i % pin.length) + salt[i % salt.length]! + iter + i) & 255),
};

const input = (name = 'Sam') => ({ name, color: 1, avatar: 'owl', kids: false });

/** The real wiring in miniature: libraries saved under their keys, device settings laid over every profile. */
function hostOver(kv: KV, startId = MAIN_ID, startKids = false): LibraryHost & { current(): LibraryState } {
  let id = startId;
  let kids = startKids;
  let state = loadLibraryFor(id, kids, kv).state;
  const save = () => {
    writeJson(libraryKey(id), state, undefined, kv);
    writeJson(DEVICE_KEY, pickDevice(state.settings), undefined, kv);
  };
  return {
    current: () => state,
    activeId: () => id,
    getState: () => state,
    flush: save,
    readLibrary: (x) => loadLibraryFor(x, false, kv).state,
    switchLibrary(next, k) {
      save();
      id = next;
      kids = k;
      state = loadLibraryFor(id, kids, kv).state;
    },
    // test helper through the same door the app uses
    ...({ edit: (fn: (s: LibraryState) => LibraryState) => (state = fn(state)) } as object),
  } as LibraryHost & { current(): LibraryState };
}

const edit = (h: LibraryHost, fn: (s: LibraryState) => LibraryState) => (h as unknown as { edit(f: typeof fn): void }).edit(fn);

function setup(kv: KV = memoryStore(), now = 1_000) {
  const host = hostOver(kv);
  let t = now;
  const store = new ProfilesStore({ kv, now: () => t, host, crypto: fakeCrypto, random: () => 0.5 });
  return { kv, host, store, clock: (n: number) => void (t = n) };
}

describe('profiles', () => {
  it('PRF-001: the first run makes "main" named "Me" and gives it the library already saved, device settings included', () => {
    const kv = memoryStore();
    const legacy = updateSettings(toggleMyList(initialState(), movie('10')), { quality: '720p', qualityAuto: false, subtitleSize: 'large' });
    writeJson(LIBRARY_KEY, legacy, undefined, kv);
    const p = loadProfiles(kv, 5);
    expect(liveProfiles(p.list).map((x) => [x.id, x.name, x.kids, x.pin])).toEqual([[MAIN_ID, 'Me', false, null]]);
    expect(bootProfile(kv, 5)).toEqual({ id: MAIN_ID, kids: false });
    expect(libraryKey(MAIN_ID)).toBe(LIBRARY_KEY); // not rewritten: main keeps the original key
    const { state, device } = loadLibraryFor(MAIN_ID, false, kv);
    expect(state.myList).toEqual(['10']);
    expect(state.settings.subtitleSize).toBe('large');
    expect(device.quality).toBe('720p');
    expect(device.qualityAuto).toBe(false);
    // Nothing saved at all: an empty main.
    expect(loadLibraryFor(MAIN_ID, false, memoryStore()).state.myList).toEqual([]);
  });

  it('PRF-002: My List, ratings, progress and viewing preferences are per profile; device settings are shared; no reload', () => {
    const { store, host, kv } = setup();
    const added = store.add(input('Sam'));
    expect(added.ok).toBe(true);
    const b = (added as { profile: Profile }).profile;
    edit(host, (s) => updateSettings(toggleMyList(s, movie('10')), { subtitleSize: 'large', quality: '480p', volume: 0.4 }));
    store.enter(b.id);
    const inB = host.getState();
    expect(inB.myList).toEqual([]);
    expect(inB.settings.subtitleSize).toBe('medium'); // viewing preference: B's own
    expect(inB.settings.quality).toBe('480p'); // device-global: shared
    expect(inB.settings.volume).toBe(0.4);
    edit(host, (s) => toggleMyList(s, movie('11')));
    store.enter(MAIN_ID);
    expect(host.getState().myList).toEqual(['10']);
    expect(host.getState().settings.subtitleSize).toBe('large');
    store.enter(b.id);
    expect(host.getState().myList).toEqual(['11']);
    expect(readJson<LibraryState>(libraryKey(b.id), kv)?.myList).toEqual(['11']);
    expect(store.getView().activeId).toBe(b.id);
  });

  it('PRF-003: a Kids profile is held at family level 2 with flagged scenes skipped, and has no controls', () => {
    const open = updateSettings(initialState(), { level: 0, familySkips: false });
    const locked = enforceKids(open);
    expect(locked.settings.level).toBe(KIDS_LEVEL);
    expect(locked.settings.familySkips).toBe(true);
    expect(enforceKids(locked)).toBe(locked); // same object when already so
    // A synced or edited value cannot lower it.
    expect(enforceKids(updateSettings(locked, { level: 3, familySkips: false })).settings).toMatchObject({ level: 2, familySkips: true });
    expect(capabilities({ kids: true })).toEqual({ settings: false, sync: false, reset: false, manageProfiles: false });
    expect(capabilities({ kids: false })).toEqual({ settings: true, sync: true, reset: true, manageProfiles: true });
    // Opening a Kids profile enforces it on load.
    const kv = memoryStore();
    expect(loadLibraryFor('kid1', true, kv).state.settings).toMatchObject({ level: 2, familySkips: true });
    const { store, host } = setup();
    const kid = (store.add({ ...input('Kid'), kids: true }) as { profile: Profile }).profile;
    store.enter(kid.id);
    expect(host.getState().settings).toMatchObject({ level: 2, familySkips: true });
  });

  it('PRF-004: a PIN is stored as salt, 20000 iterations and a PBKDF2-HMAC-SHA256 hash, and checked in constant time', async () => {
    const rec = await hashPin('4821'); // the real Web Crypto
    expect(fromBase64(rec.salt)).toHaveLength(16);
    expect(rec.iter).toBe(20000);
    expect(fromBase64(rec.hash)).toHaveLength(32);
    expect(JSON.stringify(rec)).not.toContain('4821');
    expect(await verifyPin('4821', rec)).toBe(true);
    expect(await verifyPin('4822', rec)).toBe(false);
    const again = await hashPin('4821');
    expect(again.salt).not.toBe(rec.salt);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('1234567')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
    expect(isValidPin('123456')).toBe(true);
    await expect(hashPin('12', fakeCrypto)).rejects.toThrow();
    expect(constantTimeEqual(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 3))).toBe(true);
    expect(constantTimeEqual(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 4))).toBe(false);
    expect(constantTimeEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 2, 0))).toBe(false);
    // A record with a silly iteration count is refused, not run.
    expect(await verifyPin('4821', { ...rec, iter: 5_000_000_000 })).toBe(false);
  });

  it('PRF-005: five wrong PINs lock for five minutes, across reloads, and a right PIN clears the count', async () => {
    const kv = memoryStore();
    const rec = await hashPin('1234', fakeCrypto);
    let now = 10_000;
    const deps = () => ({ kv, now: () => now, crypto: fakeCrypto });
    for (let i = 1; i <= 4; i++) expect(await checkPin('0000', [rec], 'p', deps())).toEqual({ ok: false, locked: false, triesLeft: 5 - i });
    expect(await checkPin('1234', [rec], 'p', deps())).toEqual({ ok: true }); // clears the count
    for (let i = 1; i <= 4; i++) await checkPin('0000', [rec], 'p', deps());
    const fifth = await checkPin('0000', [rec], 'p', deps());
    expect(fifth).toEqual({ ok: false, locked: true, remainingMs: LOCK_MS });
    expect(readJson(LOCK_KEY, kv)).toBeTruthy(); // persisted
    now += LOCK_MS - 1;
    expect(await checkPin('1234', [rec], 'p', deps())).toMatchObject({ ok: false, locked: true }); // even the right one
    now += 1;
    expect(await checkPin('1234', [rec], 'p', deps())).toEqual({ ok: true });
    expect(afterAttempt({ fails: 0, until: 0 }, false, 0).fails).toBe(1);
  });

  it('PRF-006: a PIN opens its profile; an adult\'s PIN is needed to leave Kids or manage, and only when some adult has one', async () => {
    const { store } = setup();
    const kid = (store.add({ ...input('Kid'), kids: true }) as { profile: Profile }).profile;
    const mom = (store.add({ ...input('Mom'), pin: await hashPin('2468', fakeCrypto) }) as { profile: Profile }).profile;
    expect(guardians(store.getView().list).map((p) => p.id)).toEqual([mom.id]);
    expect(await store.unlock(mom.id, '1111')).toMatchObject({ ok: false });
    expect(await store.unlock(mom.id, '2468')).toEqual({ ok: true });
    expect(await store.unlock(kid.id, '')).toEqual({ ok: true }); // no PIN: nothing to ask
    store.enter(kid.id);
    expect(store.guardianRequired()).toBe(true);
    expect(await store.unlockGuardian('0000')).toMatchObject({ ok: false });
    expect(store.guardianRequired()).toBe(true);
    expect(await store.unlockGuardian('2468')).toEqual({ ok: true });
    expect(store.guardianRequired()).toBe(false);
    // Entering the adult with its PIN counts as the parent being there; a Kids profile never does.
    store.enter(kid.id);
    expect(store.guardianRequired()).toBe(true);
    store.enter(mom.id, true);
    expect(store.guardianRequired()).toBe(false);
    // Nobody has a PIN: no prompt at all.
    store.edit(mom.id, { pin: null });
    store.enter(kid.id);
    expect(store.guardianRequired()).toBe(false);
    expect(await store.unlockGuardian('whatever')).toEqual({ ok: true });
  });

  it('PRF-007: at most 6 profiles, valid names, colours and avatars, one profile always left, fresh ids', () => {
    let list = loadProfiles(memoryStore(), 0).list;
    for (let i = 1; i < MAX_PROFILES; i++) {
      const r = addProfile(list, input(`P${i}`), i, Math.random);
      expect('list' in r).toBe(true);
      list = (r as { list: typeof list }).list;
    }
    expect(liveProfiles(list)).toHaveLength(6);
    expect(addProfile(list, input('Seventh'), 9)).toEqual({ error: 'max' });
    expect(addProfile([], input('   '), 1)).toEqual({ error: 'name' });
    expect(addProfile([], input('x'.repeat(21)), 1)).toMatchObject({ profile: { name: 'x'.repeat(20) } });
    expect(addProfile([], { ...input(), color: 8 }, 1)).toEqual({ error: 'color' });
    expect(addProfile([], { ...input(), avatar: 'dragon' }, 1)).toEqual({ error: 'avatar' });
    expect(AVATARS).toHaveLength(12);
    const ids = liveProfiles(list).map((p) => p.id);
    expect(ids.slice(1).every((id) => /^[a-z0-9]{8}$/.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(6);
    // An id is never reused, not even a deleted one's; 'main' is never handed out.
    expect(newProfileId([{ id: 'aaaaaaaa', deleted: true }], () => 0)).not.toBe('aaaaaaaa');
    expect(newProfileId([], () => 0)).toMatch(/^[a-z0-9]{8}$/);
    expect(deleteProfile(loadProfiles(memoryStore(), 0).list, MAIN_ID)).toEqual({ error: 'last' });
  });

  it('PRF-008: the picker shows with several profiles when asked, or when the last profile has a PIN', () => {
    const list = sanitizeList([
      { id: 'main', name: 'Me', color: 0, avatar: 'fox', kids: false, pin: null, order: 0, created: 1 },
      { id: 'abcd1234', name: 'Sam', color: 1, avatar: 'owl', kids: false, pin: null, order: 1, created: 2 },
    ]);
    expect(startupPlan(list, 'abcd1234', true)).toEqual({ picker: true, profileId: 'abcd1234' });
    expect(startupPlan(list, 'abcd1234', false)).toEqual({ picker: false, profileId: 'abcd1234' });
    expect(startupPlan(list.slice(0, 1), 'main', true).picker).toBe(false); // one profile: straight in
    expect(startupPlan(list, 'gone', false).profileId).toBe('main'); // last one deleted elsewhere
    const withPin = sanitizeList([{ ...list[0], pin: { salt: 'AA==', iter: 20000, hash: 'AA==' } }, list[1]]);
    expect(startupPlan(withPin, 'main', false).picker).toBe(true); // entering needs the PIN
    const kv = memoryStore();
    const { store } = setup(kv);
    expect(store.getView().picker).toBeNull(); // a single profile starts straight in
    store.add(input('Sam'));
    expect(new ProfilesStore({ kv, now: () => 1, host: hostOver(kv) }).getView().picker).toEqual({ manage: false, dismissible: false });
    store.setAskOnStart(false);
    expect(new ProfilesStore({ kv, now: () => 1, host: hostOver(kv) }).getView().picker).toBeNull();
  });

  it('PRF-013: reset removes every profile key from this device', async () => {
    const { store, host, kv, clock } = setup();
    clock(5);
    const b = (store.add(input('Sam')) as { profile: Profile }).profile;
    store.enter(b.id);
    edit(host, (s) => toggleMyList(s, movie('10')));
    host.flush();
    await checkPin('0', [await hashPin('1234', fakeCrypto)], 'x', { kv, now: () => 1, crypto: fakeCrypto });
    const keys = () => [...Array(kv.length).keys()].map((i) => kv.key(i)!);
    expect(keys()).toEqual(expect.arrayContaining([PROFILES_KEY, DEVICE_KEY, LOCK_KEY, libraryKey(b.id)]));
    expect(keys().every((k) => k.startsWith('wmp:'))).toBe(true);
    let signedOut = 0;
    await resetSite({ localStorage: { clear: () => keys().forEach((k) => kv.removeItem(k)) }, signOutSync: () => void signedOut++, reload: () => {} });
    expect(keys()).toEqual([]);
    expect(signedOut).toBe(1); // local sign-out only: there is no call that deletes server data
  });
});
