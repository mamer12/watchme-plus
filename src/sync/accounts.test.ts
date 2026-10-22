import { applyRemoteRows, type MergeCtx } from './merge';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryStore } from '../lib/storage';
import { defaultList } from '../profiles/logic';
import { LIBRARY_KEY, PROFILES_KEY, DEVICE_KEY } from '../profiles/persist';
import type { StoredProfile } from '../profiles/types';
import { initialState, toggleMyList } from '../state/library';
import { movie, row } from './helpers';
import {
  AccountService,
  AttemptLimiter,
  DELETE_WORD,
  deleteConfirmed,
  entryPlan,
  libraryHasData,
  mapAuthError,
  mergeProfileLists,
  parseRecoveryHash,
  recoveryEnabled,
  validateCredentials,
  validatePassword,
  wipeLocalData,
  accountErrorMessage,
  type AccountApi,
  type AccountDeps,
  type MergeChoice,
} from './accounts';
import { SyncClient } from './client';
import { SyncStorage, SYNC_KEY } from './syncStorage';
import { SyncHttpError, type Session } from './types';

const PW = 'correct horse battery';
const guestSession: Session = { accessToken: 'ga', refreshToken: 'gr', expiresAt: 9e12, userId: 'guest-1' };
const accountSession: Session = { accessToken: 'aa', refreshToken: 'ar', expiresAt: 9e12, userId: 'acct-1' };

class FakeAccountApi implements AccountApi {
  calls: string[] = [];
  sessionNow: Session | null;
  failOn: Record<string, Error> = {};
  signUpResult: Session | null = accountSession;
  userEmail: string | null = 'me@example.com';
  pendingEmail = false;
  constructor(private readonly storage: SyncStorage, session: Session | null) {
    this.sessionNow = session;
  }
  private step(name: string) {
    this.calls.push(name);
    const e = this.failOn[name];
    if (e) throw e;
  }
  hasSession = () => this.sessionNow !== null;
  adopt(s: Session | null) {
    this.calls.push(s ? 'adopt' : 'adopt:null');
    this.sessionNow = s;
    this.storage.set((st) => ({ ...st, session: s }));
  }
  async passwordGrant(email: string) {
    this.step(`grant:${email}`);
    return accountSession;
  }
  async signUpWithPassword(email: string) {
    this.step(`signup:${email}`);
    if (this.signUpResult) this.adopt(this.signUpResult);
    return this.signUpResult;
  }
  async updateUser(patch: { email?: string; password?: string }) {
    this.step(`update:${Object.keys(patch).join('+')}`);
    return { email: this.pendingEmail ? null : this.userEmail, pendingEmail: this.pendingEmail };
  }
  async logout() {
    this.calls.push('logout');
  }
  async recover(email: string) {
    this.step(`recover:${email}`);
  }
  async rpc<T>(name: string): Promise<T> {
    this.step(`rpc:${name}`);
    return (name === 'create_space' ? 'space-acct' : null) as T;
  }
}

function setup(opts: { guest?: boolean; data?: boolean; remoteProfiles?: StoredProfile[] | null; localProfiles?: StoredProfile[] } = {}) {
  const kv = memoryStore();
  const storage = new SyncStorage(kv);
  if (opts.guest !== false) storage.set((s) => ({ ...s, session: guestSession, spaceId: 'space-guest', deviceName: 'Laptop', firstSyncDone: true }));
  const api = new FakeAccountApi(storage, opts.guest === false ? null : guestSession);
  const linked: { id: string; name: string; at?: number }[] = [];
  const applied: StoredProfile[][] = [];
  const deps: AccountDeps = {
    api,
    storage,
    now: () => 5000,
    deviceName: () => 'Browser',
    stopEngine: () => void api.calls.push('stop'),
    finalSync: async () => void api.calls.push('finalSync'),
    link: (id, name, o) => void linked.push({ id, name, at: o?.profilesAt }),
    localProfiles: () => opts.localProfiles ?? defaultList(1),
    hasLocalData: () => !!opts.data,
    applyProfiles: (list) => void applied.push(list),
    fetchRemoteProfiles: async () => opts.remoteProfiles ?? null,
    wipeLocal: () => wipeLocalData(kv),
  };
  return { kv, storage, api, linked, applied, svc: new AccountService(deps) };
}

const profile = (id: string, over: Partial<StoredProfile> = {}): StoredProfile => ({ id, name: id, color: 0, avatar: 'fox', kids: false, pin: null, order: 0, created: 1, ...over }) as StoredProfile;
const choose = (c: MergeChoice) => async () => c;

afterEach(() => vi.restoreAllMocks());

describe('accounts', () => {
  it('ACC-001: upgrades a guest in place with PUT user and keeps the space', async () => {
    const t = setup();
    const r = await t.svc.createAccount('  Me@Example.com ', PW, PW);
    expect(r).toEqual({ ok: true });
    expect(t.api.calls).toEqual(['update:email+password']);
    expect(t.storage.get()).toMatchObject({ email: 'me@example.com', spaceId: 'space-guest', session: guestSession });
    expect(t.linked).toEqual([]);
    expect(t.svc.isAccount()).toBe(true);
  });

  it('ACC-001: an email that still waits for confirmation is not stored as the account', async () => {
    const t = setup();
    t.api.pendingEmail = true;
    expect(await t.svc.createAccount('me@example.com', PW, PW)).toEqual({ ok: false, error: 'confirm_email' });
    expect(t.storage.get().email ?? null).toBeNull();
  });

  it('ACC-002: signs up without a session, creates the space and links', async () => {
    const t = setup({ guest: false });
    expect(await t.svc.createAccount('me@example.com', PW, PW)).toEqual({ ok: true });
    expect(t.api.calls).toEqual(['signup:me@example.com', 'adopt', 'rpc:create_space']);
    expect(t.linked).toEqual([{ id: 'space-acct', name: 'Browser', at: undefined }]);
    expect(t.storage.get().email).toBe('me@example.com');
  });

  it('ACC-002: says to check the email when sign-up needs confirmation', async () => {
    const t = setup({ guest: false });
    t.api.signUpResult = null;
    expect(await t.svc.createAccount('me@example.com', PW, PW)).toEqual({ ok: false, error: 'confirm_email' });
    expect(t.linked).toEqual([]);
  });

  it('ACC-003: signs in, stores the session, asks for the (idempotent) space and links', async () => {
    const t = setup({ guest: false });
    expect(await t.svc.signIn('Me@Example.com', PW, choose('merge'))).toEqual({ ok: true });
    expect(t.api.calls).toEqual(['grant:me@example.com', 'stop', 'adopt', 'rpc:create_space']);
    expect(t.storage.get()).toMatchObject({ email: 'me@example.com', session: accountSession, pickAfterSync: true });
    expect(t.linked).toHaveLength(1);
    expect(t.linked[0]).toMatchObject({ id: 'space-acct' });
  });

  it('ACC-003: a wrong password changes nothing', async () => {
    const t = setup();
    t.api.failOn['grant:me@example.com'] = new SyncHttpError(400, 'Invalid login credentials', 'invalid_credentials');
    expect(await t.svc.signIn('me@example.com', 'nope-nope', choose('merge'))).toEqual({ ok: false, error: 'invalid_credentials' });
    expect(t.storage.get().session).toEqual(guestSession);
    expect(t.api.calls).toEqual(['grant:me@example.com']);
  });

  it('ACC-004: sign out ends the session, wipes this device and keeps device settings', async () => {
    const t = setup({ guest: false });
    await t.svc.signIn('me@example.com', PW, choose('merge'));
    t.kv.setItem(PROFILES_KEY, '{}');
    t.kv.setItem(LIBRARY_KEY, '{"a":1}');
    t.kv.setItem(`${LIBRARY_KEY}:kid1`, '{"b":1}');
    t.kv.setItem(DEVICE_KEY, '{"volume":1}');
    t.api.calls.length = 0;
    expect(await t.svc.signOut()).toEqual({ ok: true, reload: true });
    expect(t.api.calls).toEqual(['finalSync', 'stop', 'logout']);
    for (const k of [SYNC_KEY, PROFILES_KEY, LIBRARY_KEY, `${LIBRARY_KEY}:kid1`]) expect(t.kv.getItem(k)).toBeNull();
    expect(t.kv.getItem(DEVICE_KEY)).toBe('{"volume":1}');
    expect(t.svc.isAccount()).toBe(false);
  });

  it('ACC-005: with local data the guest is asked; Add it leaves the guest space and merges the profile lists', async () => {
    const t = setup({ data: true, remoteProfiles: [profile('main', { name: 'Account me' }), profile('fam')], localProfiles: [profile('main', { name: 'Guest me' }), profile('kid')] });
    const decide = vi.fn(choose('merge'));
    expect(await t.svc.signIn('me@example.com', PW, decide)).toEqual({ ok: true });
    expect(decide).toHaveBeenCalledTimes(1);
    expect(t.api.calls).toEqual(['grant:me@example.com', 'stop', 'rpc:delete_my_account', 'adopt', 'rpc:create_space']);
    expect(t.applied[0]!.map((p) => p.id).sort()).toEqual(['fam', 'kid', 'main']);
    expect((t.applied[0]!.find((p) => p.id === 'main') as { name: string }).name).toBe('Account me');
    expect(t.linked).toEqual([{ id: 'space-acct', name: 'Laptop', at: 5000 }]);
    expect(t.storage.get().session).toEqual(accountSession);
  });

  it('ACC-005: falls back to leave_space when delete_my_account is not installed yet', async () => {
    const t = setup({ data: true });
    t.api.failOn['rpc:delete_my_account'] = new SyncHttpError(404, 'not found');
    await t.svc.signIn('me@example.com', PW, choose('merge'));
    expect(t.api.calls).toContain('rpc:leave_space');
  });

  it('ACC-005: Skip removes this device\'s library, keeps the sign-in and reloads', async () => {
    const t = setup({ data: true });
    t.kv.setItem(LIBRARY_KEY, '{"a":1}');
    t.kv.setItem(PROFILES_KEY, '{}');
    const r = await t.svc.signIn('me@example.com', PW, choose('skip'));
    expect(r).toEqual({ ok: true, reload: true });
    expect(t.kv.getItem(LIBRARY_KEY)).toBeNull();
    expect(t.kv.getItem(PROFILES_KEY)).toBeNull();
    expect(t.storage.get()).toMatchObject({ email: 'me@example.com', spaceId: 'space-acct', session: accountSession, outbox: [] });
    expect(t.linked).toEqual([]);
  });

  it('ACC-005: Cancel leaves everything as it was', async () => {
    const t = setup({ data: true });
    expect(await t.svc.signIn('me@example.com', PW, choose('cancel'))).toEqual({ ok: false, error: 'cancelled' });
    expect(t.api.calls).toEqual(['grant:me@example.com']);
    expect(t.storage.get().session).toEqual(guestSession);
  });

  it('ACC-005: no local data, no question', async () => {
    const t = setup({ data: false });
    const decide = vi.fn(choose('merge'));
    await t.svc.signIn('me@example.com', PW, decide);
    expect(decide).not.toHaveBeenCalled();
    expect(libraryHasData(initialState())).toBe(false);
    expect(libraryHasData(toggleMyList(initialState(), movie('1')))).toBe(true);
  });

  it('ACC-006: joins profile lists by id with the account winning and deletions kept', () => {
    const merged = mergeProfileLists([profile('main', { name: 'G' }), profile('kid'), { id: 'old', deleted: true }], [profile('main', { name: 'A' }), profile('old'), profile('fam')]);
    expect(merged.map((p) => p.id).sort()).toEqual(['fam', 'kid', 'main', 'old']);
    expect((merged.find((p) => p.id === 'main') as { name: string }).name).toBe('A');
    expect(merged.find((p) => p.id === 'old')).toEqual({ id: 'old', deleted: true });
  });

  it('ACC-007: maps backend errors to friendly messages and never shows the server text', () => {
    const e = (status: number, message: string, code?: string) => mapAuthError(new SyncHttpError(status, message, code));
    expect(e(400, 'Invalid login credentials', 'invalid_credentials')).toBe('invalid_credentials');
    expect(e(422, 'User already registered', 'user_already_exists')).toBe('email_taken');
    expect(e(422, 'A user with this email address has already been registered', 'email_exists')).toBe('email_taken');
    expect(e(422, 'Password should be at least 8 characters', 'weak_password')).toBe('weak_password');
    expect(e(422, 'New password should be different from the old password.', 'same_password')).toBe('same_password');
    expect(e(400, 'Email not confirmed', 'email_not_confirmed')).toBe('confirm_email');
    expect(e(0, 'Failed to fetch')).toBe('offline');
    expect(e(429, 'slow down', 'over_request_rate_limit')).toBe('rate_limited');
    expect(e(422, 'Unable to validate email address: invalid format', 'validation_failed')).toBe('invalid_email');
    expect(e(401, 'jwt expired')).toBe('session_expired');
    expect(e(503, 'upstream')).toBe('unavailable');
    expect(mapAuthError(new Error('boom'))).toBe('error');
    expect(accountErrorMessage('invalid_credentials')).not.toMatch(/Invalid login/);
  });

  it('ACC-008: deleting needs the exact word and then wipes this device', async () => {
    const t = setup();
    expect(deleteConfirmed(DELETE_WORD)).toBe(true);
    expect(deleteConfirmed(' DELETE ')).toBe(true);
    expect(deleteConfirmed('delete')).toBe(false);
    expect(deleteConfirmed('DELETE ME')).toBe(false);
    expect(await t.svc.deleteAccount('delete')).toEqual({ ok: false, error: 'confirm_word' });
    expect(t.api.calls).toEqual([]);
    t.kv.setItem(LIBRARY_KEY, '{}');
    expect(await t.svc.deleteAccount('DELETE')).toEqual({ ok: true, reload: true });
    expect(t.api.calls).toContain('rpc:delete_my_account');
    expect(t.kv.getItem(LIBRARY_KEY)).toBeNull();
    expect(t.storage.get().session).toBeNull();
  });

  it('ACC-008: a failed delete keeps everything', async () => {
    const t = setup();
    t.api.failOn['rpc:delete_my_account'] = new SyncHttpError(0, 'offline');
    expect(await t.svc.deleteAccount('DELETE')).toEqual({ ok: false, error: 'offline' });
    expect(t.storage.get().session).toEqual(guestSession);
  });

  it('ACC-009: forgot password is off unless VITE_AUTH_RECOVERY=1', async () => {
    expect(recoveryEnabled({})).toBe(false);
    expect(recoveryEnabled({ VITE_AUTH_RECOVERY: '0' })).toBe(false);
    expect(recoveryEnabled({ VITE_AUTH_RECOVERY: '1' })).toBe(true);
    const t = setup();
    expect(await t.svc.forgotPassword('me@example.com')).toEqual({ ok: false, error: 'disabled' });
    expect(t.api.calls).toEqual([]);
  });

  it('ACC-009: reads a recovery link and ignores any other hash', () => {
    const claims = btoa(JSON.stringify({ sub: 'u-9', email: 'me@example.com' })).replace(/=+$/, '');
    const token = `h.${claims}.s`;
    const r = parseRecoveryHash(`#access_token=${token}&refresh_token=rr&expires_in=3600&type=recovery`, 1000);
    expect(r).toMatchObject({ accessToken: token, refreshToken: 'rr', userId: 'u-9', email: 'me@example.com', expiresAt: 1000 + 3600 * 1000 });
    expect(parseRecoveryHash(`#access_token=${token}&refresh_token=rr&type=signup`, 1)).toBeNull();
    expect(parseRecoveryHash('#/title/1', 1)).toBeNull();
    expect(parseRecoveryHash('#access_token=nojwt&refresh_token=rr&type=recovery', 1)).toBeNull();
  });

  it('ACC-009: a followed recovery link sets the password and signs this device in', async () => {
    const t = setup({ guest: false });
    const r = { ...accountSession, email: 'me@example.com' };
    expect(await t.svc.completeRecovery(r, PW, PW)).toEqual({ ok: true });
    expect(t.api.calls).toEqual(['adopt', 'update:password', 'rpc:create_space']);
    expect(t.storage.get()).toMatchObject({ email: 'me@example.com', session: accountSession });
  });

  it('ACC-010: the welcome screen shows when sync is on and nobody is signed in', () => {
    const base = { syncEnabled: true, linked: false, recoveryPending: false, pickerWanted: false, pickAfterSignIn: false, liveProfiles: 1 };
    expect(entryPlan(base)).toBe('welcome');
    expect(entryPlan({ ...base, linked: true })).toBe('app');
    expect(entryPlan({ ...base, syncEnabled: false })).toBe('app');
    expect(entryPlan({ ...base, linked: true, pickerWanted: true })).toBe('picker');
    expect(entryPlan({ ...base, linked: true, pickAfterSignIn: true, liveProfiles: 3 })).toBe('picker');
    expect(entryPlan({ ...base, linked: true, pickAfterSignIn: true, liveProfiles: 1 })).toBe('app');
    expect(entryPlan({ ...base, recoveryPending: true })).toBe('recovery');
  });

  it('ACC-011: the password is never saved, logged or in an error', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    for (const make of [() => setup({ guest: false }), () => setup()]) {
      const t = make();
      await t.svc.signIn('me@example.com', PW, choose('merge'));
      await t.svc.createAccount('me2@example.com', PW, PW).catch(() => {});
      t.api.failOn['grant:me3@example.com'] = new SyncHttpError(400, 'Invalid login credentials', 'invalid_credentials');
      const bad = await t.svc.signIn('me3@example.com', PW, choose('merge'));
      expect(JSON.stringify(bad)).not.toContain(PW);
      const saved = [...Array(t.kv.length).keys()].map((i) => t.kv.getItem(t.kv.key(i)!)).join('|');
      expect(saved).not.toContain(PW);
    }
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it('ACC-012: checks the form, waits longer after each failure and resets on success', () => {
    expect(validateCredentials('nobody', PW)).toBe('invalid_email');
    expect(validateCredentials('me@example.com', '1234567')).toBe('weak_password');
    expect(validateCredentials('me@example.com', '12345678')).toBeNull();
    expect(validatePassword('12345678', '12345679')).toBe('password_mismatch');
    let now = 0;
    const l = new AttemptLimiter(() => now);
    expect(l.waitMs()).toBe(0);
    l.failed();
    expect(l.waitMs()).toBe(1000);
    now += 1000;
    expect(l.waitMs()).toBe(0);
    l.failed();
    expect(l.waitMs()).toBe(2000);
    for (let i = 0; i < 10; i++) l.failed();
    expect(l.waitMs()).toBe(30_000);
    l.succeeded();
    expect(l.waitMs()).toBe(0);
  });

  it('ACC-012: a form that fails the rules never reaches the backend', async () => {
    const t = setup();
    expect(await t.svc.createAccount('me@example.com', 'short', 'short')).toEqual({ ok: false, error: 'weak_password' });
    expect(await t.svc.createAccount('me@example.com', PW, PW + 'x')).toEqual({ ok: false, error: 'password_mismatch' });
    expect(await t.svc.changePassword('short')).toEqual({ ok: false, error: 'weak_password' });
    expect(t.api.calls).toEqual([]);
  });

  it('ACC-013: uses the auth endpoints and signs out of this device only', async () => {
    let session: Session | null = guestSession;
    const log: { url: string; method: string; body: unknown; headers: Record<string, string> }[] = [];
    const client = new SyncClient({
      config: { url: 'https://p.example.co', anonKey: 'anon' },
      now: () => 1_000_000,
      loadSession: () => session,
      saveSession: (s) => void (session = s),
      fetch: (async (url: string, init: RequestInit) => {
        log.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : null, headers: init.headers as Record<string, string> });
        const body = url.includes('/auth/v1/user') ? { email: 'me@example.com' } : { access_token: 'a', refresh_token: 'r', expires_in: 3600, user: { id: 'u' } };
        return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
      }) as unknown as typeof fetch,
    });
    await client.passwordGrant('me@example.com', PW);
    expect(log[0]).toMatchObject({ url: 'https://p.example.co/auth/v1/token?grant_type=password', method: 'POST', body: { email: 'me@example.com', password: PW } });
    expect(session).toEqual(guestSession); // checking a password does not switch the session
    await client.updateUser({ email: 'me@example.com', password: PW });
    expect(log[1]).toMatchObject({ url: 'https://p.example.co/auth/v1/user', method: 'PUT' });
    expect(log[1]!.headers.Authorization).toBe('Bearer ga');
    await client.signUpWithPassword('me@example.com', PW);
    expect(log[2]).toMatchObject({ url: 'https://p.example.co/auth/v1/signup', body: { email: 'me@example.com', password: PW } });
    await client.recover('me@example.com');
    expect(log[3]!.url).toBe('https://p.example.co/auth/v1/recover');
    await client.logout();
    expect(log[4]).toMatchObject({ url: 'https://p.example.co/auth/v1/logout?scope=local', method: 'POST' });
    expect(log.every((l) => l.headers.apikey === 'anon')).toBe(true);
  });
});

describe('devices of one account apply each other\'s rows', () => {
  const mine = row({ title_id: 'main~42', meta: { id: '42' }, updated_by: 'account-user' });
  const context = (selfUid: string | null): MergeCtx => ({ profileId: 'main', selfUid, pendingTs: () => undefined, playingId: null });

  it('ACC-017: a guest skips rows it wrote itself', () => {
    expect(applyRemoteRows(initialState(), 'my_list', [mine], context('account-user')).state.myList).toEqual([]);
  });

  it('ACC-017: an account applies rows written by the same user from another device', () => {
    expect(applyRemoteRows(initialState(), 'my_list', [mine], context(null)).state.myList).toEqual(['42']);
  });
});
