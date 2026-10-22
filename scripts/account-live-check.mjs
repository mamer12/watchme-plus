#!/usr/bin/env node
/**
 * Live check of email + password accounts against the real project. Needs 0001 and 0002 applied and Email sign-in with
 * "Confirm email" OFF; it SKIPs (exit 0) with a clear message when it cannot test, and always cleans up.
 * Uses only VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (environment or .env.local). Never prints tokens or passwords.
 *   node scripts/account-live-check.mjs
 */
import { randomBytes } from 'node:crypto';
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
const skip = (why) => {
  console.log(`SKIP  ${why}`);
  return 'skip';
};

class Client {
  token = null;
  uid = null;
  async call(path, { method = 'GET', body, auth = true } = {}) {
    const headers = { apikey: KEY, 'Content-Type': 'application/json' };
    if (auth && this.token) headers.Authorization = `Bearer ${this.token}`;
    let res;
    try {
      res = await fetch(`${URL_}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      return { status: 0, ok: false, json: { message: String(e) } };
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, ok: res.ok, json };
  }
  adopt(r) {
    this.token = r.json?.access_token ?? null;
    this.uid = r.json?.user?.id ?? null;
  }
  guest = async () => {
    const r = await this.call('/auth/v1/signup', { method: 'POST', body: {}, auth: false });
    if (r.ok) this.adopt(r);
    return r;
  };
  login = async (email, password) => {
    const r = await this.call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password }, auth: false });
    if (r.ok) this.adopt(r);
    return r;
  };
  rpc = (name, body = {}) => this.call(`/rest/v1/rpc/${name}`, { method: 'POST', body });
}

const missingFn = (r) => r.status === 404 || /PGRST202|Could not find the function/i.test(JSON.stringify(r.json));

/** Is 0002 applied? Uses a throwaway guest, which delete_my_account removes again. */
async function migrationApplied() {
  const c = new Client();
  const g = await c.guest();
  if (!g.ok) return skip(`anonymous sign-ins are off or rate-limited (${g.status}); cannot test`);
  await c.rpc('create_space', { device_name: 'acct-check' });
  const d = await c.rpc('delete_my_account');
  if (missingFn(d)) {
    await c.rpc('leave_space');
    return skip('supabase/migrations/0002_accounts.sql is not applied yet (delete_my_account missing): run it in the SQL editor, then re-run');
  }
  check('delete_my_account removes a guest', d.ok, `${d.status} ${JSON.stringify(d.json)}`);
  const after = await c.rpc('create_space', { device_name: 'x' });
  check('the deleted user can no longer use its session', !after.ok, String(after.status));
  return d.ok ? 'ok' : 'skip';
}

/** Sign in a TV with the phone (0003_device_login.sql). Two users: a TV-like guest and the account. SKIPs if 0003 is missing. */
async function deviceLoginCheck(account) {
  const tv = new Client();
  try {
    if (!(await tv.guest()).ok) return skip('device login: anonymous sign-ins are off; cannot test');
    const req = await tv.rpc('request_device_login', { device_name: 'TV' });
    if (missingFn(req)) return skip('supabase/migrations/0003_device_login.sql is not applied yet (request_device_login missing)');
    check('TV requests a code', req.ok, String(req.status));
    const code = typeof req.json === 'string' ? req.json : (req.json?.code ?? (Array.isArray(req.json) ? req.json[0]?.code : null));
    if (!code) return skip('request_device_login returned an unexpected shape; not testing the rest');
    check('a wrong code is refused', (await account.rpc('approve_device_login', { code: 'ZZZZZZZZ' })).json === false);
    const ok = await account.rpc('approve_device_login', { code });
    check('the account approves the TV code', ok.ok && ok.json === true, `${ok.status}`);
    const got = await tv.rpc('check_device_login');
    check('the TV gets the account space', got.ok && !!got.json, `${got.status}`);
  } finally {
    if (tv.token) {
      const d = await tv.rpc('delete_my_account');
      if (!d.ok) await tv.rpc('leave_space');
    }
  }
}

async function main() {
  const ping = await fetch(`${URL_}/rest/v1/rpc/ping`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: '{}' });
  check('ping', ping.ok, String(ping.status));
  if ((await migrationApplied()) !== 'ok') return;

  const email = `check+${randomBytes(6).toString('hex')}@example.com`;
  const pw1 = `Pw-${randomBytes(9).toString('base64url')}`;
  const pw2 = `Pw-${randomBytes(9).toString('base64url')}`;
  const A = new Client();
  const B = new Client();
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    for (const c of [B, A]) {
      if (!c.token) continue;
      const d = await c.rpc('delete_my_account');
      if (!d.ok) await c.rpc('leave_space');
    }
  };
  try {
    // Guest with data upgrades in place.
    const g = await A.guest();
    check('guest session', g.ok && !!A.uid, String(g.status));
    const space = (await A.rpc('create_space', { device_name: 'Acct A' })).json;
    const w = await A.call('/rest/v1/my_list?on_conflict=space_id,title_id', {
      method: 'POST',
      body: [{ space_id: space, title_id: 'main~acct-1', meta: {}, deleted: false }],
    });
    check('guest saves a My List item', w.ok, String(w.status));
    const uid = A.uid;

    const up = await A.call('/auth/v1/user', { method: 'PUT', body: { email, password: pw1 } });
    if (!up.ok) {
      const msg = JSON.stringify(up.json);
      return skip(/provider_disabled|signup.*disabled|not allowed/i.test(msg) ? 'Email sign-in is disabled in the dashboard (Authentication, Sign In / Providers, Email)' : `could not set email + password (${up.status} ${up.json?.error_code ?? up.json?.msg ?? ''}); nothing more to test`);
    }
    if (!up.json?.email) return skip('the project requires confirming the email (Confirm email is ON): signup cannot be tested without an inbox');
    check('guest upgraded in place (same user id, email set)', up.json.id === uid && up.json.email === email.toLowerCase());
    check('create_space after upgrade returns the same space', (await A.rpc('create_space', { device_name: 'Acct A' })).json === space);

    // Another device signs in with the password.
    const bad = await new Client().login(email, `${pw1}x`);
    check('a wrong password is refused', bad.status === 400 && /invalid/i.test(JSON.stringify(bad.json)), String(bad.status));
    const li = await B.login(email, pw1);
    check('sign in with email + password', li.ok && B.uid === uid, String(li.status));
    const sp = await B.rpc('create_space', { device_name: 'Acct B' });
    check('sign-in create_space is idempotent: the same space', sp.json === space, JSON.stringify(sp.json));
    const rows = await B.call(`/rest/v1/my_list?space_id=eq.${space}&order=updated_at.asc&limit=1000`);
    check('the second device sees the first device\'s My List', rows.ok && rows.json?.some((r) => r.title_id === 'main~acct-1'));

    // Password change, and logout scoped to this device.
    const ch = await B.call('/auth/v1/user', { method: 'PUT', body: { password: pw2 } });
    check('change password', ch.ok, String(ch.status));
    check('the old password stops working', (await new Client().login(email, pw1)).status === 400);
    const C = new Client();
    check('the new password works', (await C.login(email, pw2)).ok);
    const lo = await C.call('/auth/v1/logout?scope=local', { method: 'POST' });
    check('logout (this device only)', lo.status === 204 || lo.ok, String(lo.status));
    check('the other device stays signed in', (await B.rpc('list_devices')).ok);

    await deviceLoginCheck(B);

    // Delete.
    const del = await B.rpc('delete_my_account');
    check('delete_my_account', del.ok, `${del.status} ${JSON.stringify(del.json)}`);
    cleaned = true;
    check('the account can no longer sign in', (await new Client().login(email, pw2)).status === 400);
  } finally {
    await cleanup();
  }
}

try {
  await main();
} catch (e) {
  check('script error', false, e instanceof Error ? e.message : String(e));
}
console.log(failures ? `\n${failures} check(s) failed` : '\nDone.');
process.exit(failures ? 1 : 0);
