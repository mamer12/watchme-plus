import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveProfiles } from '../profiles/logic';
import type { StoredProfile } from '../profiles/types';
import { initialState, recordProgress, setRating, toggleMyList, updateSettings, type LibraryState } from '../state/library';
import type { ProfilesLike } from './engine';
import { legacyTombstone, parseKey, prefixKey } from './keys';
import { diffState, initialUpload, profilesItem, purgeItems } from './mapping';
import { applyRemoteRows, type MergeCtx } from './merge';
import { pickProfilesRow } from './profilesRow';
import { fakeStore, movie, row, setup, tick } from './helpers';

const ctx = (profileId: string, over: Partial<MergeCtx> = {}): MergeCtx => ({ profileId, selfUid: 'me', pendingTs: () => undefined, playingId: null, ...over });
const m10 = movie('10');

const list = (...ids: string[]): StoredProfile[] =>
  ids.map((id, i) => ({ id, name: id, color: 0, avatar: 'fox' as const, kids: false, pin: null, order: i, created: i }));

/** A profile list the engine can read and change. */
function fakeProfiles(active: string, libs: Record<string, LibraryState> = {}, initial: StoredProfile[] = list('main', 'k3x9')) {
  const state = { active, list: initial, updatedAt: 0, applied: [] as { list: StoredProfile[]; at: number }[] };
  const cbs = new Set<(l: StoredProfile[], at: number) => void>();
  const api: ProfilesLike & { state: typeof state; change(l: StoredProfile[], at: number): void } = {
    state,
    activeId: () => state.active,
    snapshot: () => ({ list: state.list, updatedAt: state.updatedAt }),
    apply: (l, at) => {
      state.applied.push({ list: l, at });
      state.list = l;
    },
    onLocalChange: (cb) => (cbs.add(cb), () => cbs.delete(cb)),
    libraries: () => Object.entries(libs).map(([id, s]) => ({ id, state: s })),
    change: (l, at) => {
      state.list = l;
      cbs.forEach((cb) => cb(l, at));
    },
  };
  return api;
}

describe('profiles in sync', () => {
  it('PRF-009: per-profile rows are keyed <profileId>~<oldKey>, settings pref:<profileId>:<name>', () => {
    let s = setRating(initialState(), m10, 'love');
    s = recordProgress(s, { video: m10, series: null, position: 600, duration: 6000, next: null, now: 5 });
    s = toggleMyList(s, movie('11'));
    s = updateSettings(s, { subtitleSize: 'large', quality: '360p', volume: 0.2 });
    const out = diffState(initialState(), s, { now: 9, device: 'Laptop', profileId: 'k3x9' });
    const keys = out.map((i) => `${i.t}:${i.k}`).sort();
    expect(keys).toEqual(['my_list:k3x9~11', 'ratings:k3x9~10', 'settings:pref:k3x9:subtitleSize', 'watch_progress:k3x9~v:10']);
    const byT = Object.fromEntries(out.map((i) => [i.t, i.row]));
    expect(byT.ratings).toMatchObject({ title_id: 'k3x9~10' });
    expect(byT.my_list).toMatchObject({ title_id: 'k3x9~11' });
    expect(byT.watch_progress).toMatchObject({ item_key: 'k3x9~v:10' });
    expect(byT.settings).toMatchObject({ key: 'pref:k3x9:subtitleSize', value: 'large' });
    // The device-global choices never leave the device.
    expect(out.some((i) => /quality|volume/.test(i.k))).toBe(false);
    expect(prefixKey('main', 'v:1')).toBe('main~v:1');
    expect(initialUpload(s, 'x', 'k3x9').every((i) => i.k.includes('k3x9'))).toBe(true);
  });

  it('PRF-010: old keys are main\'s, old tombstones are ignored, other profiles\' rows are not applied', () => {
    expect(parseKey('my_list', '10')).toEqual({ kind: 'row', profile: 'main', key: '10', legacy: true });
    expect(parseKey('watch_progress', 'v:10')).toEqual({ kind: 'row', profile: 'main', key: 'v:10', legacy: true });
    expect(parseKey('settings', 'subtitleSize')).toEqual({ kind: 'row', profile: 'main', key: 'subtitleSize', legacy: true });
    expect(parseKey('my_list', 'k3x9~10')).toEqual({ kind: 'row', profile: 'k3x9', key: '10', legacy: false });
    expect(parseKey('settings', 'pref:k3x9:level')).toEqual({ kind: 'row', profile: 'k3x9', key: 'level', legacy: false });
    expect(parseKey('settings', 'profiles')).toEqual({ kind: 'profiles' });
    expect(parseKey('settings', 'qualityCap')).toBeNull();
    expect(parseKey('my_list', 'BAD ID~10')).toBeNull();

    const legacyRow = row({ title_id: '10', meta: { id: '10', enTitle: 'Old' } });
    expect(applyRemoteRows(initialState(), 'my_list', [legacyRow], ctx('main')).state.myList).toEqual(['10']);
    expect(applyRemoteRows(initialState(), 'my_list', [legacyRow], ctx('k3x9')).state.myList).toEqual([]);
    // A prefixed row for another profile is skipped, the open profile's is applied.
    const rows = [row({ title_id: 'k3x9~11', meta: {} }), row({ title_id: 'main~12', meta: {} })];
    expect(applyRemoteRows(initialState(), 'my_list', rows, ctx('main')).state.myList).toEqual(['12']);
    expect(applyRemoteRows(initialState(), 'my_list', rows, ctx('k3x9')).state.myList).toEqual(['11']);
    // The marker a migrated device leaves behind must not erase the prefixed row.
    const have = toggleMyList(initialState(), m10);
    expect(applyRemoteRows(have, 'my_list', [row({ title_id: '10', deleted: true })], ctx('main')).state.myList).toEqual(['10']);
    expect(applyRemoteRows(have, 'my_list', [row({ title_id: 'main~10', deleted: true })], ctx('main')).state.myList).toEqual([]);
    // Settings: legacy and prefixed forms both reach main.
    const sub = [row({ key: 'subtitleSize', value: 'large' }), row({ key: 'pref:main:titleLang', value: 'ar' })];
    expect(applyRemoteRows(initialState(), 'settings', sub, ctx('main')).state.settings).toMatchObject({ subtitleSize: 'large', titleLang: 'ar' });
    expect(legacyTombstone('ratings', '10')).toEqual({ title_id: '10', rating: 0, deleted: true });
  });

  it('PRF-010: when main writes a key that is still on the server un-prefixed, the old row is tombstoned too', async () => {
    vi.useFakeTimers();
    const t = setup({ profiles: fakeProfiles('main') });
    t.api.remote.my_list = [row({ title_id: '10', meta: { id: '10', enTitle: 'Old', kind: 'movie' }, updated_at: '2026-01-01T10:00:00+00:00' })];
    t.engine.start();
    await tick(10);
    expect(t.store.getState().myList).toEqual(['10']); // read as main~10
    t.store.update((s) => ({ ...s, myList: [] })); // main removes it
    await tick(2000);
    const sent = t.api.calls.filter((c) => c.table === 'my_list').flatMap((c) => c.rows.map((r) => `${r.title_id}:${r.deleted}`));
    expect(sent).toEqual(expect.arrayContaining(['main~10:true', '10:true']));
    t.engine.stop();
    vi.useRealTimers();
  });

  it('PRF-011: the profile list is one settings row; the newest wins; tombstones travel; never an empty list', () => {
    const item = profilesItem([...list('main', 'k3x9').slice(0, 1), { id: 'gone1234', deleted: true }], 77);
    expect(item).toMatchObject({ t: 'settings', k: 'profiles', ts: 77 });
    expect((item.row.value as StoredProfile[]).at(-1)).toEqual({ id: 'gone1234', deleted: true });
    const remote = (value: unknown, over = {}) => row({ key: 'profiles', value, ...over });
    const pick = pickProfilesRow([remote(list('main')), remote(list('main', 'k3x9'), { updated_at: '2026-01-01T11:00:00+00:00' })], { selfUid: 'me', pendingTs: undefined });
    expect(liveProfiles(pick!.list).map((p) => p.id)).toEqual(['main', 'k3x9']);
    // A newer queued local change keeps its own list; an older one loses.
    expect(pickProfilesRow([remote(list('main'))], { selfUid: 'me', pendingTs: Date.parse('2026-02-01T00:00:00Z') })).toBeNull();
    expect(pickProfilesRow([remote(list('main'))], { selfUid: 'me', pendingTs: 1 })?.supersedes).toBe(true);
    // Its own echo, a list with only tombstones, and junk are ignored.
    expect(pickProfilesRow([remote(list('main'), { updated_by: 'me' })], { selfUid: 'me', pendingTs: undefined })).toBeNull();
    expect(pickProfilesRow([remote([{ id: 'main', deleted: true }])], { selfUid: 'me', pendingTs: undefined })).toBeNull();
    expect(pickProfilesRow([remote('nonsense')], { selfUid: 'me', pendingTs: undefined })).toBeNull();
    // The list never goes through the library merge.
    expect(applyRemoteRows(initialState(), 'settings', [remote(list('main'))], ctx('main')).changed).toBe(0);
  });
});

describe('profiles in the sync engine', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('PRF-011: a local list change is queued as the profiles row; a remote one is applied', async () => {
    const profiles = fakeProfiles('main');
    const t = setup({ profiles });
    t.engine.start();
    await tick(10);
    profiles.change([...list('main', 'k3x9'), { id: 'dead0000', deleted: true }], 500);
    expect(t.storage.get().outbox.find((i) => i.k === 'profiles')).toMatchObject({ t: 'settings', ts: 500 });
    await tick(2000);
    expect(t.api.calls.at(-1)!.rows[0]).toMatchObject({ key: 'profiles', space_id: 'space-1' });
    expect(t.storage.get().outbox).toEqual([]);
    t.api.remote.settings = [row({ key: 'profiles', value: list('main', 'k3x9', 'zz11zz11'), updated_at: '2026-03-01T00:00:00+00:00' })];
    await t.engine.cycle();
    expect(profiles.state.applied.at(-1)!.list.map((p) => p.id)).toEqual(['main', 'k3x9', 'zz11zz11']);
    t.engine.stop();
  });

  it('PRF-012: swapping the library for another profile\'s queues nothing and pulls that profile\'s rows', async () => {
    const profiles = fakeProfiles('main');
    const t = setup({ profiles });
    t.engine.start();
    await tick(10);
    const other = toggleMyList(setRating(initialState(), m10, 'like'), movie('11'));
    t.api.remote.my_list = [row({ title_id: 'k3x9~21', meta: { id: '21', enTitle: 'Theirs', kind: 'movie' } })];
    await t.engine.cycle();
    expect(t.store.getState().myList).toEqual([]); // not main's: not applied
    const pulls = t.api.pulls.length;
    t.engine.switchProfile(() => {
      profiles.state.active = 'k3x9';
      (t.store as ReturnType<typeof fakeStore>).replace(other);
    });
    expect(t.storage.get().outbox).toEqual([]);
    await tick(10);
    expect(t.api.pulls.length).toBeGreaterThan(pulls);
    expect(t.store.getState().myList).toContain('21'); // pulled again for the profile that opened
    // Edits afterwards belong to the new profile.
    t.store.update((s) => setRating(s, movie('12'), 'love'));
    expect(t.storage.get().outbox.map((i) => i.k)).toContain('k3x9~12');
    t.engine.stop();
  });

  it('PRF-012: deleting a profile with its synced data queues tombstones for its rows', async () => {
    const lib = updateSettings(toggleMyList(setRating(initialState(), m10, 'love'), movie('11')), { subtitleSize: 'large' });
    const items = purgeItems(lib, { id: 'k3x9' }, 42);
    const keys = items.map((i) => `${i.t}:${i.k}:${(i.row as { deleted: boolean }).deleted}`);
    expect(keys).toEqual(expect.arrayContaining(['ratings:k3x9~10:true', 'my_list:k3x9~11:true', 'settings:pref:k3x9:subtitleSize:true', 'settings:pref:k3x9:level:true']));
    expect(items.every((i) => (i.row as { deleted: boolean }).deleted)).toBe(true);
    const t = setup({ profiles: fakeProfiles('main') });
    t.engine.start();
    await tick(10);
    t.engine.queue(items);
    await tick(2000);
    const sent = t.api.calls.flatMap((c) => c.rows.map((r) => String(r.title_id ?? r.key)));
    expect(sent).toEqual(expect.arrayContaining(['k3x9~10', 'k3x9~11']));
    t.engine.stop();
  });

  it('PRF-009: linking uploads every profile\'s library under its own keys, and the list', async () => {
    const libs = { main: toggleMyList(initialState(), movie('1')), k3x9: toggleMyList(initialState(), movie('2')) };
    const profiles = fakeProfiles('main', libs);
    profiles.state.updatedAt = 99;
    const t = setup({ profiles, linked: false });
    t.storage.set((s) => ({ ...s, spaceId: 'space-1', deviceName: 'Laptop', firstSyncDone: false }));
    t.engine.beginLink();
    await tick(2000);
    const sent = t.api.calls.flatMap((c) => c.rows.map((r) => String(r.title_id ?? r.key)));
    expect(sent).toEqual(expect.arrayContaining(['main~1', 'k3x9~2', 'profiles']));
    t.engine.stop();
  });
});
