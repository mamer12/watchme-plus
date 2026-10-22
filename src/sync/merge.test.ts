import { describe, expect, it } from 'vitest';
import { continueWatching, initialState, recordProgress, resumeFor, setRating, toggleMyList, updateSettings } from '../state/library';
import { diffState, initialUpload, progressRow, SYNCED_SETTING_KEYS, DEVICE_SETTING_KEYS } from './mapping';
import { applyRemoteRows, type MergeCtx } from './merge';
import { episode, movie, row } from './helpers';

const ctx = (over: Partial<MergeCtx> = {}): MergeCtx => ({ profileId: 'main', selfUid: 'me', pendingTs: () => undefined, playingId: null, ...over });
const m10 = movie('10');

describe('sync merge rules', () => {
  it('SYNC-005: applies server rows, skips this device\'s own echoes and keeps a newer queued local change', () => {
    const remote = row({ title_id: '10', rating: 10, updated_at: '2026-01-01T10:00:00+00:00' });
    expect(applyRemoteRows(initialState(), 'ratings', [remote], ctx()).state.ratings['10']).toBe('love');
    expect(applyRemoteRows(initialState(), 'ratings', [{ ...remote, updated_by: 'me' }], ctx()).changed).toBe(0);
    const local = setRating(initialState(), m10, 'dislike');
    const newer = applyRemoteRows(local, 'ratings', [remote], ctx({ pendingTs: () => Date.parse('2026-01-01T10:05:00Z') }));
    expect(newer.state.ratings['10']).toBe('dislike');
    const older = applyRemoteRows(local, 'ratings', [remote], ctx({ pendingTs: () => Date.parse('2026-01-01T09:00:00Z') }));
    expect(older.state.ratings['10']).toBe('love');
    expect(older.superseded).toEqual(['main~10']);
    // client_ts (when the person acted) beats the server's time of arrival
    const replay = row({ title_id: '10', rating: 10, client_ts: '2026-01-01T08:00:00+00:00', updated_at: '2026-01-01T12:00:00+00:00' });
    expect(applyRemoteRows(local, 'ratings', [replay], ctx({ pendingTs: () => Date.parse('2026-01-01T09:00:00Z') })).state.ratings['10']).toBe('dislike');
  });

  it('SYNC-006: tombstones remove My List items, remote items go first, and a first link keeps local-only titles', () => {
    const local = toggleMyList(toggleMyList(initialState(), m10), movie('11'));
    expect(local.myList).toEqual(['11', '10']);
    const removed = applyRemoteRows(local, 'my_list', [row({ title_id: 'main~10', deleted: true })], ctx());
    expect(removed.state.myList).toEqual(['11']);
    const added = applyRemoteRows(local, 'my_list', [row({ title_id: '12', meta: { id: '12', enTitle: 'Remote', kind: 'movie' } })], ctx());
    expect(added.state.myList).toEqual(['12', '11', '10']);
    expect(added.state.snapshots['12']?.enTitle).toBe('Remote');
    // The first upload carries every local title, and an older tombstone on the server does not remove it.
    const up = initialUpload(local, 'Laptop');
    expect(up.filter((i) => i.t === 'my_list').map((i) => i.k).sort()).toEqual(['main~10', 'main~11']);
    const tomb = applyRemoteRows(local, 'my_list', [row({ title_id: 'main~10', deleted: true })], ctx({ pendingTs: (_t, k) => (k === 'main~10' ? Date.parse('2026-01-02T00:00:00Z') : undefined) }));
    expect(tomb.state.myList).toContain('10');
  });

  it('SYNC-007: applies remote progress and the series pointer, labels the device, and leaves the playing video alone', () => {
    const series = episode('20', 1);
    const ep2 = episode('21', 2);
    const phone = recordProgress(initialState(), { video: ep2, series, position: 1200, duration: 2400, next: null, now: 5000 });
    const rowOut = { ...row({ updated_at: '2026-01-01T10:00:00+00:00' }), ...progressRow(phone, '21', 'Phone') };
    const here = applyRemoteRows(initialState(), 'watch_progress', [rowOut as never], ctx());
    expect(here.state.progress['21']).toMatchObject({ position: 1200, duration: 2400, seriesId: '20', from: 'Phone' });
    const [item] = continueWatching(here.state);
    expect(item).toMatchObject({ videoId: '21', season: 1, episode: 2, fraction: 0.5, from: 'Phone' });
    expect(resumeFor(here.state, series)).toMatchObject({ videoId: '21', position: 1200 });
    expect(here.from).toBe('Phone');
    // Mid-playback on this device the remote position is ignored.
    const playing = applyRemoteRows(initialState(), 'watch_progress', [rowOut as never], ctx({ playingId: '21' }));
    expect(playing.changed).toBe(0);
    expect(playing.state.progress['21']).toBeUndefined();
    // A tombstone (history cleared elsewhere) removes progress and its pointer.
    const cleared = applyRemoteRows(here.state, 'watch_progress', [row({ item_key: 'main~v:21', title_id: '20', deleted: true, updated_at: '2026-01-01T11:00:00+00:00' })], ctx());
    expect(cleared.state.progress['21']).toBeUndefined();
    expect(cleared.state.seriesLast['20']).toBeUndefined();
  });

  it('SYNC-011: queues only the shared preferences, never quality, volume, preview or provider choices', () => {
    expect([...SYNCED_SETTING_KEYS].sort()).toEqual(['autoplayNext', 'familySkips', 'level', 'subtitleBackground', 'subtitleColor', 'subtitleLang', 'subtitleOffset', 'subtitleSize', 'titleLang']);
    const prev = initialState();
    const device = updateSettings(prev, { quality: '720p', qualityAuto: false, qualityCap: '480p', previewAutoplay: false, volume: 0.3, muted: true });
    expect(DEVICE_SETTING_KEYS.every((k) => device.settings[k] !== prev.settings[k])).toBe(true);
    expect(diffState(prev, device, { now: 1, device: 'x', profileId: 'main' })).toEqual([]);
    const shared = updateSettings(prev, { subtitleSize: 'large', level: 2 });
    expect(diffState(prev, shared, { now: 1, device: 'x', profileId: 'main' }).map((i) => i.k).sort()).toEqual(['pref:main:level', 'pref:main:subtitleSize']);
    // Remote values for device-only keys or bad values are refused.
    const bad = applyRemoteRows(prev, 'settings', [row({ key: 'qualityCap', value: '240p' }), row({ key: 'level', value: 7 }), row({ key: 'subtitleSize', value: 'large' })], ctx());
    expect(bad.state.settings.qualityCap).toBe(prev.settings.qualityCap);
    expect(bad.state.settings.level).toBe(0);
    expect(bad.state.settings.subtitleSize).toBe('large');
    // The first upload skips settings still at their defaults.
    expect(initialUpload(updateSettings(prev, { level: 3 }), 'x').filter((i) => i.t === 'settings').map((i) => i.k)).toEqual(['pref:main:level']);
  });
});
