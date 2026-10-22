#!/usr/bin/env node
/**
 * Live check of the sync backend: two anonymous clients pair, save and read progress and My List, then both leave.
 * Uses VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from the environment (or from .env.local; only those two names are read).
 * No dependencies beyond fetch. Prints PASS / FAIL / SKIP lines; exits 1 on any FAIL. Leaves no data behind.
 *   node scripts/sync-live-check.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function fromEnvFile() {
  const file = fileURLToPath(new URL('../.env.local', import.meta.url));
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^(VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
const file = fromEnvFile();
const URL_ = (process.env.VITE_SUPABASE_URL || file.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.VITE_SUPABASE_ANON_KEY || file.VITE_SUPABASE_ANON_KEY || '';
if (!URL_ || !KEY) {
  console.error('FAIL  VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set');
  process.exit(1);
}

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `  (${detail})` : ''}`);
};

class Client {
  constructor(label) {
    this.label = label;
  }
  async call(path, { method = 'GET', body, headers = {}, auth = true } = {}) {
    const h = { apikey: KEY, 'Content-Type': 'application/json', ...headers };
    if (auth) h.Authorization = `Bearer ${this.token}`;
    const res = await fetch(`${URL_}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, ok: res.ok, json };
  }
  async signUp() {
    const r = await this.call('/auth/v1/signup', { method: 'POST', body: {}, auth: false });
    if (!r.ok) throw new Error(`signup ${this.label}: ${r.status} ${JSON.stringify(r.json)}`);
    this.token = r.json.access_token;
    this.refresh = r.json.refresh_token;
    this.uid = r.json.user.id;
  }
  rpc(name, body = {}) {
    return this.call(`/rest/v1/rpc/${name}`, { method: 'POST', body });
  }
  upsert(table, rows) {
    return this.call(`/rest/v1/${table}`, { method: 'POST', body: rows, headers: { Prefer: 'resolution=merge-duplicates,return=minimal,missing=default' } });
  }
  pull(table, space, cursor) {
    const since = cursor ? `&updated_at=gte.${encodeURIComponent(cursor)}` : '';
    return this.call(`/rest/v1/${table}?space_id=eq.${space}${since}&order=updated_at.asc&limit=1000`);
  }
}

const A = new Client('A');
const B = new Client('B');
let space = null;

async function realtimeCheck() {
  if (typeof WebSocket === 'undefined') return console.log('SKIP  realtime (no WebSocket in this Node)');
  const wsUrl = `${URL_.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(KEY)}&vsn=1.0.0`;
  const topic = `realtime:check-${space}`;
  const ws = new WebSocket(wsUrl);
  const got = new Promise((resolve) => {
    const t = setTimeout(() => resolve('timeout'), 8000);
    ws.onmessage = (e) => {
      const f = JSON.parse(String(e.data));
      if (f.event === 'phx_reply' && f.topic === topic) {
        if (f.payload?.status === 'ok') A.upsert('my_list', [{ space_id: space, title_id: 'rt-1', meta: {}, deleted: false, client_ts: new Date().toISOString() }]);
        else {
          clearTimeout(t);
          resolve(`join ${JSON.stringify(f.payload)}`);
        }
      }
      if (f.event === 'postgres_changes' && f.payload?.data?.record?.title_id === 'rt-1') {
        clearTimeout(t);
        resolve('ok');
      }
    };
    ws.onerror = () => resolve('socket error');
    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          topic,
          event: 'phx_join',
          ref: '1',
          payload: {
            config: { broadcast: { ack: false, self: false }, presence: { key: '' }, postgres_changes: [{ event: '*', schema: 'public', table: 'my_list', filter: `space_id=eq.${space}` }] },
            access_token: B.token,
          },
        }),
      );
  });
  const result = await got;
  try {
    ws.close();
  } catch {}
  check('realtime: B receives A\'s My List write', result === 'ok', result);
}

try {
  const ping = await fetch(`${URL_}/rest/v1/rpc/ping`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: '{}' });
  check('ping', ping.ok, String(ping.status));

  await A.signUp();
  await B.signUp();
  check('two anonymous sign-ups', !!A.uid && !!B.uid && A.uid !== B.uid);

  const created = await A.rpc('create_space', { device_name: 'Check A' });
  space = created.json;
  check('A creates a space', created.ok && typeof space === 'string', JSON.stringify(created.json));
  const again = await A.rpc('create_space', { device_name: 'Check A' });
  check('create_space is idempotent', again.json === space);

  const code = (await A.rpc('create_pairing_code')).json;
  check('A gets an 8-character pairing code', typeof code === 'string' && /^[A-Z0-9]{8}$/.test(code), String(code));

  const wrong = await B.rpc('redeem_pairing_code', { code: 'ZZZZZZZZ', device_name: 'Check B' });
  check('wrong code returns null', wrong.ok && wrong.json === null, JSON.stringify(wrong.json));
  const redeemed = await B.rpc('redeem_pairing_code', { code: `${code.slice(0, 4).toLowerCase()} - ${code.slice(4)}`, device_name: 'Check B' });
  check('B joins with a sloppy-typed code', redeemed.ok && redeemed.json === space, JSON.stringify(redeemed.json));
  const reuse = await B.rpc('redeem_pairing_code', { code, device_name: 'Check B' });
  check('a used code cannot be reused', reuse.json === null);

  const devices = (await A.rpc('list_devices')).json ?? [];
  check('list_devices shows both, A marked', devices.length === 2 && devices.filter((d) => d.is_me).length === 1 && devices.some((d) => d.device_name === 'Check B'), JSON.stringify(devices));

  const t0 = new Date(Date.now() - 60_000).toISOString();
  const up = await A.upsert('watch_progress', [
    { space_id: space, item_key: 'v:live-1', title_id: 'live-1', position_ms: 734000, duration_ms: 2700000, finished: false, deleted: false, meta: { dev: 'Check A', s: 2, e: 4 }, client_ts: new Date().toISOString() },
  ]);
  check('A saves progress', up.ok, `${up.status} ${JSON.stringify(up.json)}`);
  const list = await A.upsert('my_list', [{ space_id: space, title_id: 'live-1', meta: { id: 'live-1', enTitle: 'Live' }, deleted: false, client_ts: new Date().toISOString() }]);
  check('A adds to My List', list.ok, `${list.status} ${JSON.stringify(list.json)}`);

  const seen = await B.pull('watch_progress', space, null);
  const p = seen.json?.[0];
  check('B reads A\'s progress', seen.ok && p?.position_ms === 734000 && p?.updated_by === A.uid && p?.meta?.dev === 'Check A', JSON.stringify(seen.json));
  const cursor = p?.updated_at;
  const seenList = await B.pull('my_list', space, null);
  check('B reads A\'s My List item', seenList.json?.some((r) => r.title_id === 'live-1' && !r.deleted));

  await B.upsert('watch_progress', [
    { space_id: space, item_key: 'v:live-1', title_id: 'live-1', position_ms: 900000, duration_ms: 2700000, finished: false, deleted: false, meta: {}, client_ts: new Date().toISOString() },
  ]);
  const delta = await A.pull('watch_progress', space, cursor);
  check('A sees B\'s newer position through a delta pull', delta.json?.length === 1 && delta.json[0].position_ms === 900000 && delta.json[0].updated_by === B.uid, JSON.stringify(delta.json));

  await A.upsert('watch_progress', [
    { space_id: space, item_key: 'v:live-1', title_id: 'live-1', position_ms: 1000, duration_ms: 2700000, finished: false, deleted: false, meta: {}, client_ts: t0 },
  ]);
  const afterStale = await B.pull('watch_progress', space, null);
  check('a stale offline replay (older client_ts) is ignored', afterStale.json?.[0]?.position_ms === 900000, JSON.stringify(afterStale.json?.[0]?.position_ms));

  await B.upsert('my_list', [{ space_id: space, title_id: 'live-1', meta: {}, deleted: true, client_ts: new Date().toISOString() }]);
  const tomb = await A.pull('my_list', space, null);
  check('My List tombstone reaches A', tomb.json?.find((r) => r.title_id === 'live-1')?.deleted === true);

  // ---- profiles: prefixed keys, the profile list as one settings row, legacy keys, tombstones ----
  const now = () => new Date().toISOString();
  const wp = (key, extra = {}) => ({ space_id: space, item_key: key, title_id: 'live-p', position_ms: 1000, duration_ms: 2700000, finished: false, deleted: false, meta: {}, client_ts: now(), ...extra });
  const profileList = [
    { id: 'main', name: 'Me', color: 0, avatar: 'fox', kids: false, pin: { salt: 'AAAAAAAAAAAAAAAAAAAAAA==', iter: 20000, hash: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' }, order: 0, created: Date.now() },
    { id: 'k3x9live', name: 'Kids', color: 3, avatar: 'owl', kids: true, pin: null, order: 1, created: Date.now() },
    { id: 'gone1234', deleted: true },
  ];
  const prof = await A.upsert('settings', [{ space_id: space, key: 'profiles', value: profileList, deleted: false, client_ts: now() }]);
  check('A saves the profile list as one settings row', prof.ok, `${prof.status} ${JSON.stringify(prof.json)}`);
  const profPull = await B.pull('settings', space, null);
  const profRow = profPull.json?.find((r) => r.key === 'profiles');
  check('B reads the list back intact, tombstone and PIN record included', Array.isArray(profRow?.value) && profRow.value.length === 3 && profRow.value[2]?.deleted === true && profRow.value[0]?.pin?.iter === 20000 && profRow.value[1]?.kids === true, JSON.stringify(profRow?.value));

  const pk = await A.upsert('watch_progress', [wp('main~v:live-p'), wp('k3x9live~v:live-p', { position_ms: 5000 }), wp('v:live-p', { position_ms: 111 })]);
  check('A saves the same video for two profiles plus an old un-prefixed row', pk.ok, `${pk.status} ${JSON.stringify(pk.json)}`);
  const pkRows = (await B.pull('watch_progress', space, null)).json ?? [];
  const posOf = (k) => pkRows.find((r) => r.item_key === k)?.position_ms;
  check('the profiles\' rows stay separate (main~, k3x9live~, legacy)', posOf('main~v:live-p') === 1000 && posOf('k3x9live~v:live-p') === 5000 && posOf('v:live-p') === 111, JSON.stringify(pkRows.map((r) => [r.item_key, r.position_ms])));

  const prefs = await A.upsert('settings', [
    { space_id: space, key: 'pref:k3x9live:subtitleSize', value: 'large', deleted: false, client_ts: now() },
    { space_id: space, key: 'pref:main:level', value: 2, deleted: false, client_ts: now() },
  ]);
  check('A saves per-profile preferences (pref:<id>:<name>)', prefs.ok, `${prefs.status} ${JSON.stringify(prefs.json)}`);
  const prefRows = (await B.pull('settings', space, null)).json ?? [];
  check('B reads them', prefRows.some((r) => r.key === 'pref:k3x9live:subtitleSize' && r.value === 'large') && prefRows.some((r) => r.key === 'pref:main:level' && r.value === 2));

  const listKeys = await A.upsert('my_list', [
    { space_id: space, title_id: 'k3x9live~live-p', meta: {}, deleted: false, client_ts: now() },
    { space_id: space, title_id: 'live-p', meta: {}, deleted: false, client_ts: now() },
  ]);
  check('My List rows for a profile and an old one coexist', listKeys.ok, `${listKeys.status}`);
  // main moves to prefixed keys and tombstones the old row; the old tombstone arrives as deleted for the next device.
  await A.upsert('my_list', [
    { space_id: space, title_id: 'main~live-p', meta: {}, deleted: false, client_ts: now() },
    { space_id: space, title_id: 'live-p', meta: {}, deleted: true, client_ts: now() },
  ]);
  const listRows = (await B.pull('my_list', space, null)).json ?? [];
  check('the old key is tombstoned, the prefixed ones live', listRows.find((r) => r.title_id === 'live-p')?.deleted === true && listRows.find((r) => r.title_id === 'main~live-p')?.deleted === false && listRows.find((r) => r.title_id === 'k3x9live~live-p')?.deleted === false);
  const del = await B.upsert('my_list', [{ space_id: space, title_id: 'k3x9live~live-p', meta: {}, deleted: true, client_ts: now() }]);
  check('deleting a profile\'s row is a tombstone', del.ok && (await A.pull('my_list', space, null)).json?.find((r) => r.title_id === 'k3x9live~live-p')?.deleted === true);

  await realtimeCheck();
} catch (e) {
  check('script ran without an unexpected error', false, e instanceof Error ? e.message : String(e));
} finally {
  // Clean-up: both leave; the empty space (and its data) is deleted by the server.
  for (const c of [A, B]) {
    if (!c.token) continue;
    const r = await c.rpc('leave_space');
    check(`${c.label} leaves the space`, r.ok, `${r.status} ${JSON.stringify(r.json)}`);
  }
  if (A.token && space) {
    const gone = await A.pull('watch_progress', space, null);
    check('after leaving, the data is no longer readable', gone.ok && Array.isArray(gone.json) && gone.json.length === 0, JSON.stringify(gone.json));
  }
}
console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
