/** A tiny fetch client for the sync backend: anonymous sign-in, token refresh, RPCs and table reads/writes. */
import type { SyncConfig } from './config';
import { SyncHttpError, type RemoteRow, type Session, type SyncApi, type Table } from './types';

/** Refresh when fewer than this many ms are left. */
const REFRESH_MARGIN_MS = 60_000;
/** Below this a keepalive request (pagehide) doesn't trust the token. */
const KEEPALIVE_MIN_MS = 15_000;

export interface ClientDeps {
  config: SyncConfig;
  fetch: typeof fetch;
  now: () => number;
  loadSession: () => Session | null;
  saveSession: (s: Session | null) => void;
  /** True when this device is signed in to an account (an email), not a guest. */
  isAccount?: () => boolean;
}

interface AuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  user?: { id?: string };
}

function parseSession(body: AuthResponse, now: number): Session {
  const expiresAt = typeof body.expires_at === 'number' ? body.expires_at * 1000 : now + (body.expires_in ?? 3600) * 1000;
  const userId = body.user?.id;
  if (!body.access_token || !body.refresh_token || !userId) throw new SyncHttpError(500, 'bad_auth_response');
  return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt, userId };
}

export class SyncClient implements SyncApi {
  private refreshing: Promise<Session> | null = null;

  constructor(private readonly d: ClientDeps) {}

  /** Always read from storage: another tab may have rotated the refresh token. */
  session(): Session | null {
    return this.d.loadSession();
  }

  hasSession(): boolean {
    return this.session() !== null;
  }

  /**
   * The id whose own writes a pull should skip. A guest is one user per device, so its own rows are already applied.
   * An account is ONE user shared by every device: the rows it wrote came from another device and must be applied.
   */
  userId(): string | null {
    const s = this.session();
    return s && !this.d.isAccount?.() ? s.userId : null;
  }

  tokenFresh(): boolean {
    const s = this.session();
    return !!s && s.expiresAt - this.d.now() > KEEPALIVE_MIN_MS;
  }

  private async http(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string>; token?: string | null; keepalive?: boolean }): Promise<Response> {
    const headers: Record<string, string> = { apikey: this.d.config.anonKey, 'Content-Type': 'application/json', ...init.headers };
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    try {
      return await this.d.fetch(`${this.d.config.url}${path}`, {
        method: init.method ?? 'GET',
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        keepalive: init.keepalive,
      });
    } catch (e) {
      throw new SyncHttpError(0, e instanceof Error ? e.message : 'network');
    }
  }

  private async fail(res: Response): Promise<never> {
    let message = `http_${res.status}`;
    let code: string | undefined;
    try {
      const j = (await res.json()) as { message?: string; msg?: string; error_description?: string; error_code?: string; code?: string | number };
      message = j.message ?? j.msg ?? j.error_description ?? message;
      if (typeof j.error_code === 'string') code = j.error_code;
      else if (typeof j.code === 'string') code = j.code;
    } catch {
      /* no JSON body */
    }
    throw new SyncHttpError(res.status, message, code);
  }

  /** Creates the anonymous account (once per browser). */
  async signUp(): Promise<Session> {
    const res = await this.http('/auth/v1/signup', { method: 'POST', body: {} });
    if (!res.ok) return this.fail(res);
    const s = parseSession((await res.json()) as AuthResponse, this.d.now());
    this.d.saveSession(s);
    return s;
  }

  // ---- accounts (email + password) ---------------------------------------------------------------
  // Passwords go straight into a request body: they are never stored, logged or put in an error message.

  /** Makes a session the one this browser uses (or forgets it with null). */
  adopt(s: Session | null): void {
    this.d.saveSession(s);
  }

  /** Checks an email and password. The session is returned, not saved: the caller decides when to switch to it. */
  async passwordGrant(email: string, password: string): Promise<Session> {
    const res = await this.http('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
    if (!res.ok) return this.fail(res);
    return parseSession((await res.json()) as AuthResponse, this.d.now());
  }

  /** A new account with no guest session first. Null when the project wants the email confirmed before it signs in. */
  async signUpWithPassword(email: string, password: string): Promise<Session | null> {
    const res = await this.http('/auth/v1/signup', { method: 'POST', body: { email, password } });
    if (!res.ok) return this.fail(res);
    const body = (await res.json()) as AuthResponse;
    if (!body.access_token) return null;
    const s = parseSession(body, this.d.now());
    this.d.saveSession(s);
    return s;
  }

  /** Changes this user's email and/or password. `pendingEmail`: the new email still waits for a confirmation link. */
  async updateUser(patch: { email?: string; password?: string }): Promise<{ email: string | null; pendingEmail: boolean }> {
    const res = await this.authed('/auth/v1/user', { method: 'PUT', body: patch });
    if (!res.ok) return this.fail(res);
    const u = (await res.json()) as { email?: string | null; new_email?: string | null };
    return { email: u.email || null, pendingEmail: !!patch.email && !u.email && !!u.new_email };
  }

  /** Ends this browser's session on the server only (the other devices stay signed in). Never throws. */
  async logout(): Promise<void> {
    const s = this.session();
    if (!s) return;
    try {
      await this.http('/auth/v1/logout?scope=local', { method: 'POST', token: s.accessToken });
    } catch {
      /* the local wipe happens anyway */
    }
  }

  async recover(email: string): Promise<void> {
    const res = await this.http('/auth/v1/recover', { method: 'POST', body: { email } });
    if (!res.ok) return this.fail(res);
  }

  private refresh(): Promise<Session> {
    if (this.refreshing) return this.refreshing;
    const run = async (): Promise<Session> => {
      const before = this.session();
      if (!before) throw new SyncHttpError(401, 'no_session');
      const res = await this.http('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: before.refreshToken } });
      if (!res.ok) {
        // Another tab may have refreshed already (single-use tokens): use what it saved.
        const now = this.session();
        if (now && now.refreshToken !== before.refreshToken && now.expiresAt - this.d.now() > REFRESH_MARGIN_MS) return now;
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          this.d.saveSession(null);
          throw new SyncHttpError(401, 'auth_lost');
        }
        return this.fail(res);
      }
      const s = parseSession((await res.json()) as AuthResponse, this.d.now());
      this.d.saveSession(s);
      return s;
    };
    this.refreshing = run().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /** A valid access token. `allowSignUp` is for starting or joining a space only; syncing never makes a new account. */
  async accessToken(opts: { allowSignUp?: boolean; minValidityMs?: number } = {}): Promise<string> {
    let s = this.session();
    if (!s) {
      if (!opts.allowSignUp) throw new SyncHttpError(401, 'no_session');
      s = await this.signUp();
    }
    if (s.expiresAt - this.d.now() < (opts.minValidityMs ?? REFRESH_MARGIN_MS)) s = await this.refresh();
    return s.accessToken;
  }

  /** Authenticated request; one refresh-and-retry on 401. */
  private async authed(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string>; keepalive?: boolean }, allowSignUp = false): Promise<Response> {
    let token = await this.accessToken({ allowSignUp });
    let res = await this.http(path, { ...init, token });
    if (res.status === 401 && !init.keepalive) {
      token = (await this.refresh()).accessToken;
      res = await this.http(path, { ...init, token });
    }
    return res;
  }

  async rpc<T>(name: string, body: Record<string, unknown> = {}, allowSignUp = false): Promise<T> {
    const res = await this.authed(`/rest/v1/rpc/${name}`, { method: 'POST', body }, allowSignUp);
    if (!res.ok) return this.fail(res);
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  async upsert(table: Table, rows: Record<string, unknown>[], opts: { keepalive?: boolean } = {}): Promise<void> {
    if (!rows.length) return;
    const onConflict = table === 'watch_progress' ? 'space_id,item_key' : table === 'settings' ? 'space_id,key' : 'space_id,title_id';
    const res = await this.authed(`/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      body: rows,
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal,missing=default' },
      keepalive: opts.keepalive,
    });
    if (!res.ok) return this.fail(res);
  }

  async pull(table: Table, spaceId: string, cursor: string | null, limit: number): Promise<RemoteRow[]> {
    // gte (not gt): rows written by one batch share a timestamp, and a page can end in the middle of that group.
    const since = cursor ? `&updated_at=gte.${encodeURIComponent(cursor)}` : '';
    const res = await this.authed(`/rest/v1/${table}?space_id=eq.${encodeURIComponent(spaceId)}${since}&order=updated_at.asc&limit=${limit}`, {});
    if (!res.ok) return this.fail(res);
    const rows = (await res.json()) as unknown;
    return Array.isArray(rows) ? (rows as RemoteRow[]) : [];
  }
}
