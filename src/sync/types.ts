export type Table = 'watch_progress' | 'my_list' | 'ratings' | 'settings';
export const TABLES: readonly Table[] = ['watch_progress', 'my_list', 'ratings', 'settings'];

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** ms since the epoch */
  expiresAt: number;
  userId: string;
}

/** A row as the server returns it. */
export interface RemoteRow {
  updated_at: string;
  updated_by?: string | null;
  client_ts?: string | null;
  deleted: boolean;
  [column: string]: unknown;
}

/** One queued change. `row` is the table row without space_id and client_ts. */
export interface OutboxItem {
  t: Table;
  /** item_key / title_id / settings key */
  k: string;
  row: Record<string, unknown>;
  /** When the person made the change (ms): sent as client_ts so a stale offline replay loses. */
  ts: number;
}

export interface SyncPersisted {
  v: 1;
  session: Session | null;
  spaceId: string | null;
  deviceName: string;
  cursors: Partial<Record<Table, string>>;
  outbox: OutboxItem[];
  firstSyncDone: boolean;
  /** The account's email; null/absent for a guest. Never the password. */
  email?: string | null;
  /** Just signed in: show "Who's watching?" once the first sync has landed. */
  pickAfterSync?: boolean;
  /** Old un-prefixed rows (table|key) seen on the server, still to be tombstoned by the main profile. */
  legacy?: string[];
}

export class SyncHttpError extends Error {
  constructor(
    /** 0 = no network */
    public readonly status: number,
    message: string,
    /** The auth server's machine-readable code (`invalid_credentials`, `email_exists`...), when it sent one. */
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'SyncHttpError';
  }
}

/** What the engine needs from the backend. */
export interface SyncApi {
  userId(): string | null;
  upsert(table: Table, rows: Record<string, unknown>[], opts?: { keepalive?: boolean }): Promise<void>;
  /** Rows with updated_at >= cursor, oldest first. */
  pull(table: Table, spaceId: string, cursor: string | null, limit: number): Promise<RemoteRow[]>;
  /** True when the access token is good for a while (so a keepalive request can use it without refreshing). */
  tokenFresh(): boolean;
}
