import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryStore } from '../lib/storage';
import { initialState, recordProgress, setRating, toggleMyList, updateSettings } from '../state/library';
import { PROGRESS_PUSH_MS, POLL_MS, retryDelay } from './engine';
import { episode, FakeApi, movie, row, setup, SyncHttpError, tick } from './helpers';
import { resetSite } from '../lib/resetSite';
import { getSyncStatus } from './status';
import { SyncStorage } from './syncStorage';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('sync engine', () => {
  it('SYNC-008: persists the outbox, keeps the newest change per item and sends it after a reload', async () => {
    const kv = memoryStore();
    const storage = new SyncStorage(kv);
    const offline = new FakeApi();
    offline.failWith = () => new SyncHttpError(0, 'offline');
    const a = setup({ api: offline, storage });
    a.engine.start();
    await tick();
    a.store.update((s) => setRating(s, movie('10'), 'like'));
    a.store.update((s) => setRating(s, movie('10'), 'love'));
    expect(storage.get().outbox).toHaveLength(1);
    expect(storage.get().outbox[0]!.row).toMatchObject({ title_id: 'main~10', rating: 10 });
    a.engine.stop();
    // New page load: a fresh engine reads the same storage.
    const online = new FakeApi();
    const b = setup({ api: online, storage: new SyncStorage(kv), state: a.store.getState() });
    b.engine.start();
    await tick(10);
    expect(online.calls.filter((c) => c.table === 'ratings')).toHaveLength(1);
    expect(online.calls[0]!.rows[0]).toMatchObject({ space_id: 'space-1', title_id: 'main~10', rating: 10, deleted: false });
    expect(b.storage.get().outbox).toEqual([]);
    b.engine.stop();
  });

  it('SYNC-009: backs off 2 s, 4 s, 8 s, reports offline or error, and recovers', async () => {
    expect([1, 2, 3, 4, 10].map((n) => retryDelay(n, () => 0.5))).toEqual([2000, 4000, 8000, 16000, 300000]);
    const api = new FakeApi();
    let failing: Error | null = new SyncHttpError(500, 'boom');
    api.failWith = () => failing;
    const t = setup({ api });
    t.engine.start();
    await tick();
    expect(getSyncStatus().phase).toBe('error');
    expect(api.pulls).toHaveLength(1);
    await tick(1999);
    expect(api.pulls).toHaveLength(1);
    await tick(2);
    expect(api.pulls).toHaveLength(2); // +2 s
    await tick(3900);
    expect(api.pulls).toHaveLength(2);
    await tick(200);
    expect(api.pulls).toHaveLength(3); // +4 s
    failing = new SyncHttpError(0, 'offline');
    await tick(8100);
    expect(getSyncStatus().phase).toBe('offline');
    failing = null;
    await tick(16_100);
    expect(getSyncStatus().phase).toBe('idle');
    expect(getSyncStatus().lastSyncAt).not.toBeNull();
    t.engine.stop();
  });

  it('SYNC-010: pushes progress at most every 15 s, but right away on flush and when the page closes', async () => {
    const api = new FakeApi();
    const t = setup({ api });
    t.engine.start();
    await tick();
    const m = movie('10');
    for (let i = 0; i < 9; i++) {
      t.store.update((s) => recordProgress(s, { video: m, series: null, position: 100 + i * 5, duration: 6000, next: null }));
      await tick(5000);
    }
    const times = api.calls.filter((c) => c.table === 'watch_progress').map((c) => c.at);
    expect(times.length).toBeGreaterThanOrEqual(2);
    expect(times.length).toBeLessThanOrEqual(4);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(PROGRESS_PUSH_MS);
    // Pause / seek / end
    const before = api.calls.length;
    t.store.update((s) => recordProgress(s, { video: m, series: null, position: 900, duration: 6000, next: null }));
    t.engine.flush();
    await tick(1);
    expect(api.calls.length).toBe(before + 1);
    expect(api.calls.at(-1)!.rows[0]).toMatchObject({ item_key: 'main~v:10', position_ms: 900000, duration_ms: 6000000, finished: false });
    // Page closing: a keepalive request, sent synchronously
    t.store.update((s) => recordProgress(s, { video: m, series: null, position: 905, duration: 6000, next: null }));
    t.env.fireLeave();
    expect(api.calls.at(-1)!.keepalive).toBe(true);
    expect(api.calls.at(-1)!.rows[0]).toMatchObject({ position_ms: 905000 });
    t.engine.stop();
  });

  it('SYNC-010: other changes go out after a short pause, not after 15 s', async () => {
    const t = setup();
    t.engine.start();
    await tick();
    t.store.update((s) => toggleMyList(s, movie('10')));
    await tick(2000);
    expect(t.api.calls.map((c) => c.table)).toEqual(['my_list']);
    t.engine.stop();
  });

  it('SYNC-012: sends client_ts = when the change was made, even after a long wait offline', async () => {
    const api = new FakeApi();
    api.failWith = () => new SyncHttpError(0, 'offline');
    const t = setup({ api });
    t.engine.start();
    await tick();
    const madeAt = Date.now();
    t.store.update((s) => setRating(s, movie('10'), 'like'));
    await tick(12 * 3600 * 1000);
    api.failWith = null;
    t.env.fireWake();
    await tick(10);
    const sent = api.calls.find((c) => c.table === 'ratings')!;
    expect(sent.rows[0]!.client_ts).toBe(new Date(madeAt).toISOString());
    expect(Date.now() - madeAt).toBeGreaterThan(11 * 3600 * 1000);
    t.engine.stop();
  });

  it('SYNC-013: uploads local data on link, lets newer server data win, and announces what the first sync brought', async () => {
    const api = new FakeApi();
    api.remote.my_list = [
      row({ title_id: '30', meta: { id: '30', enTitle: 'From TV', kind: 'movie', dev: 'TV' }, updated_at: '2026-03-01T11:00:00+00:00' }),
      row({ title_id: '31', meta: { id: '31', enTitle: 'Another', kind: 'movie', dev: 'TV' }, updated_at: '2026-03-01T11:01:00+00:00' }),
    ];
    api.remote.ratings = [row({ title_id: '10', rating: 10, updated_at: '2026-03-01T11:02:00+00:00' })];
    let s0 = toggleMyList(setRating(recordProgress(updateSettings(initialState(), { level: 2 }), { video: movie('10'), series: null, position: 50, duration: 600, next: null, now: 1000 }), movie('10'), 'dislike'), movie('10'));
    s0 = toggleMyList(s0, episode('1', 1)); // another local-only title
    const t = setup({ api, state: s0, firstSyncDone: false });
    t.engine.beginLink();
    await tick(10);
    // Pulled first: the server's rating (newer than the first upload's time 0) beats the local one.
    expect(t.store.getState().ratings['10']).toBe('love');
    expect(t.store.getState().myList).toEqual(expect.arrayContaining(['30', '31', '10', '1']));
    // The union went up: local-only My List titles, progress and the non-default setting; the rating did not.
    const sent = api.calls.flatMap((c) => c.rows.map((r) => `${c.table}:${r.item_key ?? r.title_id ?? r.key}`));
    expect(sent).toEqual(expect.arrayContaining(['my_list:main~10', 'my_list:main~1', 'watch_progress:main~v:10', 'settings:pref:main:level']));
    expect(sent).not.toContain('ratings:10');
    expect(getSyncStatus().toast).toBe('Synced 3 items from TV');
    expect(t.storage.get().firstSyncDone).toBe(true);
    t.engine.stop();
  });

  it('SYNC-014: pulls from the stored cursor on start, when the tab is visible again, online again, every 60 s and from realtime', async () => {
    const api = new FakeApi();
    api.remote.ratings = [row({ title_id: '10', rating: 8, updated_at: '2026-03-01T11:00:00.123456+00:00' })];
    const rt: { push?: (t: never, r: never) => void; stopped: boolean } = { stopped: false };
    const t = setup({ api });
    (t.engine as unknown as { d: { realtime: unknown } }).d.realtime = (_id: string, on: (t: never, r: never) => void) => {
      rt.push = on;
      return () => (rt.stopped = true);
    };
    t.engine.start();
    await tick();
    expect(api.pulls.map((p) => p.cursor)).toEqual([null, null, null, null]);
    expect(t.storage.get().cursors.ratings).toBe('2026-03-01T11:00:00.123456+00:00');
    expect(t.store.getState().ratings['10']).toBe('like');
    api.pulls.length = 0;
    t.env.fireWake();
    await tick();
    expect(api.pulls.find((p) => p.table === 'ratings')!.cursor).toBe('2026-03-01T11:00:00.123456+00:00');
    api.pulls.length = 0;
    await tick(POLL_MS);
    expect(api.pulls.length).toBeGreaterThanOrEqual(4);
    // hidden tab: no polling
    t.env.visible = false;
    api.pulls.length = 0;
    await tick(POLL_MS * 2);
    expect(api.pulls).toHaveLength(0);
    // realtime applies at once
    rt.push!('my_list' as never, row({ title_id: '77', meta: { id: '77', enTitle: 'Live', kind: 'movie' } }) as never);
    await tick();
    expect(t.store.getState().myList).toContain('77');
    t.engine.stop();
    expect(rt.stopped).toBe(true);
  });

  it('SYNC-014: a push never moves local data that changed while it was in flight and a poison row is dropped', async () => {
    const api = new FakeApi();
    api.failWith = () => null;
    const origUpsert = api.upsert.bind(api);
    api.upsert = async (table, rows, o) => {
      if (rows.some((r) => r.title_id === 'main~bad')) throw new SyncHttpError(400, 'check constraint');
      return origUpsert(table, rows, o);
    };
    const t = setup({ api });
    t.engine.start();
    await tick();
    t.store.update((s) => toggleMyList(toggleMyList(s, movie('10')), { ...movie('11'), id: 'bad' }));
    await tick(2000);
    expect(api.calls.flatMap((c) => c.rows.map((r) => r.title_id))).toEqual(['main~10']);
    expect(t.storage.get().outbox).toEqual([]);
    expect(t.engine.dropped).toBe(1);
    t.engine.stop();
  });

  it('SYNC-016: reset signs out of sync first, without any request', async () => {
    const order: string[] = [];
    const api = new FakeApi();
    const t = setup({ api });
    t.engine.start();
    await tick();
    const calls = api.calls.length + api.pulls.length;
    await resetSite({
      signOutSync: () => {
        order.push('sync');
        t.engine.stop();
        t.storage.clear();
      },
      localStorage: { clear: () => order.push('localStorage') },
      reload: () => order.push('reload'),
    });
    expect(order).toEqual(['sync', 'localStorage', 'reload']);
    expect(t.storage.get().spaceId).toBeNull();
    expect(api.calls.length + api.pulls.length).toBe(calls);
    t.store.update((s) => setRating(s, movie('10'), 'love'));
    await tick(20_000);
    expect(api.calls).toHaveLength(0);
  });
});
