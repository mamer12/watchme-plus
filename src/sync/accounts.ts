/** Accounts: sign in with an email and password on every device and the library follows. Pure rules and the account
 * flows over injected dependencies (backend, storage, the profile store), so they run in tests as they do in the browser.
 *
 * Guest = the anonymous session (a private space, no email). Account = an email + password on the same kind of user:
 * "Create account" on a guest upgrades it in place, so the space and its data stay. The password only ever travels in a
 * request body: it is never stored, logged or put in an error message.
 */
import { isTombstone, type StoredProfile } from '../profiles/types';
import { sanitizeList } from '../profiles/logic';
import { PROFILES_KEY, LIBRARY_KEY, LOCK_KEY } from '../profiles/persist';
import type { KV } from '../lib/storage';
import type { LibraryState } from '../state/library';
import { SYNC_KEY, type SyncStorage } from './syncStorage';
import { SyncHttpError, type Session } from './types';

export const MIN_PASSWORD = 8;
export const DELETE_WORD = 'DELETE';

// ---- errors -----------------------------------------------------------------------------------

export type AccountError =
  | 'invalid_credentials'
  | 'email_taken'
  | 'weak_password'
  | 'invalid_email'
  | 'password_mismatch'
  | 'same_password'
  | 'confirm_email'
  | 'confirm_word'
  | 'offline'
  | 'rate_limited'
  | 'session_expired'
  | 'disabled'
  | 'unavailable'
  | 'error';

const MESSAGES: Record<AccountError, string> = {
  invalid_credentials: 'That email and password do not match. Check them and try again.',
  email_taken: 'That email already has an account. Sign in instead.',
  weak_password: `Choose a password with at least ${MIN_PASSWORD} characters.`,
  invalid_email: 'That does not look like an email address.',
  password_mismatch: 'The two passwords are not the same.',
  same_password: 'Choose a password that is different from the current one.',
  confirm_email: 'Check your email for a link to confirm your address, then sign in.',
  confirm_word: `Type ${DELETE_WORD} to confirm.`,
  offline: 'No connection. Check your internet and try again.',
  rate_limited: 'Too many tries. Wait a moment and try again.',
  session_expired: 'Your session ended. Sign in again.',
  disabled: 'Accounts are not available right now.',
  unavailable: 'The service is busy. Try again in a minute.',
  error: 'Something went wrong. Try again.',
};

export const accountErrorMessage = (e: AccountError): string => MESSAGES[e];

/** Maps whatever the backend said to one of our friendly errors. Never returns the raw server text. */
export function mapAuthError(e: unknown): AccountError {
  if (!(e instanceof SyncHttpError)) return 'error';
  const msg = e.message.toLowerCase();
  const code = (e.code ?? '').toLowerCase();
  if (e.status === 0) return 'offline';
  if (e.status === 429 || code.includes('rate_limit')) return 'rate_limited';
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) return 'invalid_credentials';
  if (code === 'email_exists' || code === 'user_already_exists' || /already (been )?registered|already exists/.test(msg)) return 'email_taken';
  if (code === 'same_password' || msg.includes('different from the old')) return 'same_password';
  if (code === 'weak_password' || /password (should|must)|at least \d+ characters|weak/.test(msg)) return 'weak_password';
  if (code === 'email_not_confirmed' || msg.includes('not confirmed')) return 'confirm_email';
  if (code === 'email_address_invalid' || (code === 'validation_failed' && msg.includes('email')) || /unable to validate email|invalid email/.test(msg)) return 'invalid_email';
  if (code === 'signup_disabled' || code === 'email_provider_disabled' || msg.includes('signups not allowed')) return 'disabled';
  if (e.status === 401) return 'session_expired';
  if (e.status >= 500) return 'unavailable';
  return 'error';
}

// ---- input rules ------------------------------------------------------------------------------

export const normalizeEmail = (s: string): string => s.trim().toLowerCase();
export const looksLikeEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 254;

/** Checks the form before anything is sent. `again` is the repeated password (create / change). */
export function validateCredentials(email: string, password: string, again?: string): AccountError | null {
  if (!looksLikeEmail(normalizeEmail(email))) return 'invalid_email';
  return validatePassword(password, again);
}

export function validatePassword(password: string, again?: string): AccountError | null {
  if (password.length < MIN_PASSWORD) return 'weak_password';
  if (again !== undefined && again !== password) return 'password_mismatch';
  return null;
}

/** Deleting an account needs the word typed exactly (spaces around it don't count). */
export const deleteConfirmed = (typed: string): boolean => typed.trim() === DELETE_WORD;

/** "Forgot password?" needs email sending set up on the backend, so it is off unless the build says `VITE_AUTH_RECOVERY=1`. */
export const recoveryEnabled = (env: Record<string, unknown> = import.meta.env as Record<string, unknown>): boolean => env.VITE_AUTH_RECOVERY === '1';

// ---- retry limiter ----------------------------------------------------------------------------

/** After a failed try the form waits 1 s, then 2, 4, 8... up to 30 s before it accepts another. A success resets it. */
export class AttemptLimiter {
  private failures = 0;
  private until = 0;
  constructor(private readonly now: () => number) {}

  waitMs(): number {
    return Math.max(0, this.until - this.now());
  }

  failed(): void {
    this.failures += 1;
    this.until = this.now() + Math.min(30_000, 1000 * 2 ** (this.failures - 1));
  }

  succeeded(): void {
    this.failures = 0;
    this.until = 0;
  }
}

// ---- recovery links ---------------------------------------------------------------------------

export interface RecoverySession extends Session {
  email: string | null;
}

function jwtClaims(token: string): { sub?: string; email?: string } | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='))) as { sub?: string; email?: string };
  } catch {
    return null;
  }
}

/** `#access_token=…&refresh_token=…&type=recovery` from the link in the email, or null when it is anything else. */
export function parseRecoveryHash(hash: string, now: number): RecoverySession | null {
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  if (q.get('type') !== 'recovery') return null;
  const accessToken = q.get('access_token');
  const refreshToken = q.get('refresh_token');
  if (!accessToken || !refreshToken) return null;
  const claims = jwtClaims(accessToken);
  if (!claims?.sub) return null;
  const at = Number(q.get('expires_at'));
  const inSec = Number(q.get('expires_in'));
  const expiresAt = Number.isFinite(at) && at > 0 ? at * 1000 : now + (Number.isFinite(inSec) && inSec > 0 ? inSec : 3600) * 1000;
  return { accessToken, refreshToken, expiresAt, userId: claims.sub, email: claims.email ?? null };
}

// ---- local data -------------------------------------------------------------------------------

/** Does this library hold anything the person made (so signing in elsewhere should ask what to do with it)? */
export const libraryHasData = (s: LibraryState): boolean => Object.keys(s.progress).length > 0 || s.myList.length > 0 || Object.keys(s.ratings).length > 0;

/** Removes every per-profile library, the profile list, PIN lock and sync state from this browser (device settings stay). */
export function wipeLocalData(kv: KV): void {
  const doomed: string[] = [SYNC_KEY, PROFILES_KEY, LOCK_KEY];
  for (let i = 0; i < kv.length; i++) {
    const k = kv.key(i);
    if (k && (k === LIBRARY_KEY || k.startsWith(`${LIBRARY_KEY}:`))) doomed.push(k);
  }
  for (const k of doomed) {
    try {
      kv.removeItem(k);
    } catch {
      /* storage unavailable: nothing to remove */
    }
  }
}

/** One list from two: a profile on both sides takes the account's version (so the guest's 'main' merges into the account's
 * 'main'), a deletion on either side stays deleted, a profile only one side has is kept. */
export function mergeProfileLists(local: StoredProfile[], remote: StoredProfile[]): StoredProfile[] {
  const out = new Map<string, StoredProfile>(remote.map((p) => [p.id, p]));
  for (const p of local) {
    const theirs = out.get(p.id);
    if (!theirs) out.set(p.id, p);
    else if (isTombstone(p) && !isTombstone(theirs)) out.set(p.id, p);
  }
  return sanitizeList([...out.values()]);
}

// ---- what the app shows first -----------------------------------------------------------------

export type EntryPlan = 'recovery' | 'welcome' | 'picker' | 'app';

/** The screen the app starts on. Sync off: the old behaviour. Sync on and nobody signed in (not even a guest): the welcome
 * screen. After signing in, "Who's watching?" appears when the account has several profiles. */
export function entryPlan(i: { syncEnabled: boolean; linked: boolean; recoveryPending: boolean; pickerWanted: boolean; pickAfterSignIn: boolean; liveProfiles: number }): EntryPlan {
  if (i.recoveryPending) return 'recovery';
  if (i.syncEnabled && !i.linked) return 'welcome';
  if (i.pickerWanted || (i.pickAfterSignIn && i.liveProfiles > 1)) return 'picker';
  return 'app';
}

// ---- the flows --------------------------------------------------------------------------------

export interface AccountApi {
  hasSession(): boolean;
  adopt(s: Session | null): void;
  passwordGrant(email: string, password: string): Promise<Session>;
  signUpWithPassword(email: string, password: string): Promise<Session | null>;
  updateUser(patch: { email?: string; password?: string }): Promise<{ email: string | null; pendingEmail: boolean }>;
  logout(): Promise<void>;
  recover(email: string): Promise<void>;
  rpc<T>(name: string, body?: Record<string, unknown>, allowSignUp?: boolean): Promise<T>;
}

export interface AccountDeps {
  api: AccountApi;
  storage: SyncStorage;
  now: () => number;
  deviceName(): string;
  stopEngine(): void;
  /** Sends what is still waiting (best effort, bounded) before this device lets go of the account. */
  finalSync(): Promise<void>;
  /** Links this device to a space and starts syncing; `profilesAt` makes the profile list we hand over count as a fresh change. */
  link(spaceId: string, deviceName: string, opts?: { profilesAt?: number }): void;
  localProfiles(): StoredProfile[];
  hasLocalData(): boolean;
  applyProfiles(list: StoredProfile[], at: number): void;
  /** The account's profile list as stored on the server, or null when it has none yet. */
  fetchRemoteProfiles(spaceId: string): Promise<StoredProfile[] | null>;
  wipeLocal(): void;
}

export type MergeChoice = 'merge' | 'skip' | 'cancel';
export type AccountResult = { ok: true; reload?: boolean } | { ok: false; error: AccountError | 'cancelled' };

const fail = (e: unknown): AccountResult => ({ ok: false, error: mapAuthError(e) });

export class AccountService {
  constructor(private readonly d: AccountDeps) {}

  email(): string | null {
    return this.d.storage.get().email ?? null;
  }
  isAccount(): boolean {
    return !!this.email();
  }

  private name(): string {
    return this.d.storage.get().deviceName || this.d.deviceName();
  }

  /** The space of the signed-in user (made on first use, the same one every time), and this device joins it. */
  private async ensureSpace(opts?: { profilesAt?: number }): Promise<string> {
    const name = this.name();
    const id = await this.d.api.rpc<string>('create_space', { device_name: name });
    this.d.link(id, name, opts);
    return id;
  }

  /** A guest becomes an account in place (same user, same space, same data); without a session a new account starts. */
  async createAccount(emailIn: string, password: string, again?: string): Promise<AccountResult> {
    const email = normalizeEmail(emailIn);
    const bad = validateCredentials(email, password, again);
    if (bad) return { ok: false, error: bad };
    try {
      if (this.d.api.hasSession()) {
        const r = await this.d.api.updateUser({ email, password });
        if (r.pendingEmail) return { ok: false, error: 'confirm_email' };
        const had = !!this.d.storage.get().spaceId;
        this.d.storage.set((s) => ({ ...s, email: r.email ?? email }));
        if (!had) await this.ensureSpace();
        return { ok: true };
      }
      const session = await this.d.api.signUpWithPassword(email, password);
      if (!session) return { ok: false, error: 'confirm_email' };
      this.d.storage.set((s) => ({ ...s, email, pickAfterSync: false }));
      await this.ensureSpace();
      return { ok: true };
    } catch (e) {
      return fail(e);
    }
  }

  /** `decide` is asked only when this device has data of its own and is not already signed in to that account. */
  async signIn(emailIn: string, password: string, decide: () => Promise<MergeChoice>): Promise<AccountResult> {
    const email = normalizeEmail(emailIn);
    if (!looksLikeEmail(email)) return { ok: false, error: 'invalid_email' };
    if (!password) return { ok: false, error: 'invalid_credentials' };
    if (this.isAccount()) return { ok: false, error: 'error' };

    let session: Session;
    try {
      session = await this.d.api.passwordGrant(email, password);
    } catch (e) {
      return fail(e);
    }

    const cur = this.d.storage.get();
    const guest = !!cur.session;
    const hasData = this.d.hasLocalData();
    let choice: MergeChoice = 'merge';
    if (hasData) choice = await decide();
    if (choice === 'cancel') return { ok: false, error: 'cancelled' };

    // Leave the guest space so no orphan data remains (removing the guest user as well when the backend can).
    this.d.stopEngine();
    if (guest) await this.dropGuest();

    this.d.api.adopt(session);
    const localList = this.d.localProfiles();
    this.d.storage.set((s) => ({ ...s, session, spaceId: null, email, cursors: {}, firstSyncDone: false, pickAfterSync: true, ...(choice === 'skip' ? { outbox: [] } : {}) }));
    try {
      const name = this.name();
      const sid = await this.d.api.rpc<string>('create_space', { device_name: name });
      if (choice === 'skip') {
        // The account's data replaces this device's: wipe it, keep the sign-in, and the next start pulls everything.
        this.d.storage.set((s) => ({ ...s, spaceId: sid, deviceName: name }));
        const keep = this.d.storage.get();
        this.d.wipeLocal();
        this.d.storage.set(() => keep);
        return { ok: true, reload: true };
      }
      const remote = await this.d.fetchRemoteProfiles(sid).catch(() => null);
      if (remote && hasData) {
        const at = this.d.now();
        this.d.applyProfiles(mergeProfileLists(localList, remote), at);
        this.d.link(sid, name, { profilesAt: at });
      } else this.d.link(sid, name);
      return { ok: true };
    } catch (e) {
      return fail(e);
    }
  }

  private async dropGuest(): Promise<void> {
    try {
      await this.d.api.rpc('delete_my_account');
      return;
    } catch {
      /* the account migration may not be applied yet: just leave the space */
    }
    try {
      await this.d.api.rpc('leave_space');
    } catch {
      /* offline: the guest space is cleaned up by the server later */
    }
    await this.d.api.logout();
  }

  /** Sign out of the account on this device; the data stays in the account. The caller has already asked to confirm. */
  async signOut(): Promise<AccountResult> {
    await this.d.finalSync().catch(() => {});
    this.d.stopEngine();
    await this.d.api.logout();
    this.d.storage.clear();
    this.d.wipeLocal();
    return { ok: true, reload: true };
  }

  async changePassword(password: string, again?: string): Promise<AccountResult> {
    const bad = validatePassword(password, again);
    if (bad) return { ok: false, error: bad };
    try {
      await this.d.api.updateUser({ password });
      return { ok: true };
    } catch (e) {
      return fail(e);
    }
  }

  /** Needs the word DELETE typed; removes the account, its space and all its data from the server, then this device's copy. */
  async deleteAccount(typed: string): Promise<AccountResult> {
    if (!deleteConfirmed(typed)) return { ok: false, error: 'confirm_word' };
    this.d.stopEngine();
    try {
      await this.d.api.rpc('delete_my_account');
    } catch (e) {
      return fail(e);
    }
    this.d.api.adopt(null);
    this.d.storage.clear();
    this.d.wipeLocal();
    return { ok: true, reload: true };
  }

  async forgotPassword(emailIn: string): Promise<AccountResult> {
    if (!recoveryEnabled()) return { ok: false, error: 'disabled' };
    const email = normalizeEmail(emailIn);
    if (!looksLikeEmail(email)) return { ok: false, error: 'invalid_email' };
    try {
      await this.d.api.recover(email);
      return { ok: true };
    } catch (e) {
      return fail(e);
    }
  }

  /** The person opened the reset link: that session may set a new password, and this device is signed in with it. */
  async completeRecovery(r: RecoverySession, password: string, again?: string): Promise<AccountResult> {
    const bad = validatePassword(password, again);
    if (bad) return { ok: false, error: bad };
    try {
      this.d.api.adopt(r);
      await this.d.api.updateUser({ password });
      const session: Session = { accessToken: r.accessToken, refreshToken: r.refreshToken, expiresAt: r.expiresAt, userId: r.userId };
      this.d.storage.set((s) => ({ ...s, session, email: r.email ?? s.email ?? null, pickAfterSync: true }));
      if (!this.d.storage.get().spaceId) await this.ensureSpace();
      return { ok: true };
    } catch (e) {
      return fail(e);
    }
  }
}
