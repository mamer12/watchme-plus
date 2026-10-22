import { describe, expect, it } from 'vitest';
import { SyncClient } from './client';
import { parseRealtimeFrame, connectRealtime, type WebSocketLike } from './realtime';
import { SyncHttpError, type Session } from './types';

const config = { url: 'https://p.supabase.co', anonKey: 'anon' };

function harness(initial: Session | null, responses: (url: string, init: RequestInit) => { status: number; body: unknown }) {
  let session = initial;
  let now = 1_000_000;
  const log: { url: string; init: RequestInit }[] = [];
  const client = new SyncClient({
    config,
    now: () => now,
    loadSession: () => session,
    saveSession: (s) => void (session = s),
    fetch: (async (url: string, init: RequestInit) => {
      log.push({ url, init });
      const r = responses(url, init);
      return { ok: r.status < 400, status: r.status, json: async () => r.body, text: async () => JSON.stringify(r.body) } as Response;
    }) as unknown as typeof fetch,
  });
  return { client, log, get session() { return session; }, advance: (ms: number) => void (now += ms) };
}

const auth = (n: number) => ({ access_token: `a${n}`, refresh_token: `r${n}`, expires_in: 3600, user: { id: 'u1' } });

describe('sync client', () => {
  it('SYNC-015: signs up anonymously once, refreshes before expiry and saves the new tokens', async () => {
    const h = harness(null, (url) => (url.includes('/auth/v1/signup') ? { status: 200, body: auth(1) } : url.includes('grant_type=refresh_token') ? { status: 200, body: auth(2) } : { status: 200, body: 'space-1' }));
    expect(await h.client.rpc<string>('create_space', { device_name: 'X' }, true)).toBe('space-1');
    expect(h.session).toMatchObject({ accessToken: 'a1', refreshToken: 'r1', userId: 'u1' });
    const rpc = h.log.at(-1)!;
    expect(rpc.url).toBe('https://p.supabase.co/rest/v1/rpc/create_space');
    expect(rpc.init.headers).toMatchObject({ apikey: 'anon', Authorization: 'Bearer a1' });
    h.advance(3600 * 1000 - 30_000); // inside the 60 s margin
    await h.client.rpc('list_devices');
    expect(h.log.some((l) => l.url.includes('grant_type=refresh_token') && String(l.init.body).includes('r1'))).toBe(true);
    expect(h.session).toMatchObject({ accessToken: 'a2', refreshToken: 'r2' });
    expect(h.log.filter((l) => l.url.includes('/signup'))).toHaveLength(1);
  });

  it('SYNC-015: never creates a new account when the session is gone, and clears a dead refresh token', async () => {
    const none = harness(null, () => ({ status: 200, body: [] }));
    await expect(none.client.pull('my_list', 's', null, 10)).rejects.toMatchObject({ status: 401, message: 'no_session' });
    expect(none.log).toHaveLength(0);
    const dead = harness({ accessToken: 'a', refreshToken: 'r', expiresAt: 1, userId: 'u' }, () => ({ status: 400, body: { error_description: 'Invalid Refresh Token' } }));
    await expect(dead.client.rpc('list_devices')).rejects.toMatchObject({ message: 'auth_lost' });
    expect(dead.session).toBeNull();
  });

  it('SYNC-015: upserts with merge-duplicates and pulls deltas ordered by updated_at', async () => {
    const live: Session = { accessToken: 'a', refreshToken: 'r', expiresAt: 9e12, userId: 'u' };
    const h = harness(live, () => ({ status: 200, body: [{ updated_at: 'x' }] }));
    await h.client.upsert('watch_progress', [{ space_id: 's', item_key: 'v:1' }]);
    expect(h.log[0]!.url).toBe('https://p.supabase.co/rest/v1/watch_progress?on_conflict=space_id,item_key');
    expect(h.log[0]!.init.headers).toMatchObject({ Prefer: expect.stringContaining('resolution=merge-duplicates') });
    await h.client.pull('ratings', 's 1', '2026-01-01T10:00:00.5+00:00', 1000);
    expect(h.log[1]!.url).toBe('https://p.supabase.co/rest/v1/ratings?space_id=eq.s%201&updated_at=gte.2026-01-01T10%3A00%3A00.5%2B00%3A00&order=updated_at.asc&limit=1000');
    const failing = harness(live, () => ({ status: 500, body: { message: 'down' } }));
    await expect(failing.client.upsert('ratings', [{}])).rejects.toBeInstanceOf(SyncHttpError);
  });

  it('SYNC-017: parses realtime row changes and ignores everything else; subscribes with the space filter', () => {
    const frame = { topic: 'realtime:x', event: 'postgres_changes', payload: { data: { table: 'my_list', type: 'UPDATE', record: { title_id: '5', deleted: true } } } };
    expect(parseRealtimeFrame(JSON.stringify(frame))).toEqual({ table: 'my_list', type: 'UPDATE', record: { title_id: '5', deleted: true } });
    expect(parseRealtimeFrame(JSON.stringify({ topic: 'phoenix', event: 'phx_reply', payload: {} }))).toBeNull();
    expect(parseRealtimeFrame('not json')).toBeNull();
    expect(parseRealtimeFrame({ ...frame, payload: { data: { table: 'spaces', type: 'INSERT', record: {} } } })).toBeNull();

    const sent: string[] = [];
    const sock: WebSocketLike = { send: (d) => void sent.push(d), close() {}, onopen: null, onclose: null, onerror: null, onmessage: null };
    const got: unknown[] = [];
    const stop = connectRealtime({ url: 'https://p.supabase.co', anonKey: 'k', getToken: async () => 'tok', open: () => sock }, 'sp-1', (c) => got.push(c));
    return Promise.resolve().then(async () => {
      await new Promise((r) => setTimeout(r, 0));
      sock.onopen?.();
      const join = JSON.parse(sent[0]!);
      expect(join.event).toBe('phx_join');
      expect(join.payload.access_token).toBe('tok');
      expect(join.payload.config.postgres_changes).toHaveLength(4);
      expect(join.payload.config.postgres_changes[0]).toMatchObject({ schema: 'public', filter: 'space_id=eq.sp-1' });
      sock.onmessage?.({ data: JSON.stringify(frame) });
      expect(got).toHaveLength(1);
      stop();
    });
  });
});
