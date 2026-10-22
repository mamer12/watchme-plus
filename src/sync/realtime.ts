/** Realtime changes over the backend's websocket (Phoenix channel protocol). Best effort: polling covers anything missed. */
import type { Table } from './types';
import { TABLES } from './types';

export interface RealtimeChange {
  table: Table;
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  record: Record<string, unknown>;
}

interface Frame {
  topic?: string;
  event?: string;
  payload?: unknown;
  ref?: string | null;
}

/** Decodes one websocket message into a change, or null for anything else (acks, heartbeats, errors). */
export function parseRealtimeFrame(data: unknown): RealtimeChange | null {
  let f: Frame;
  try {
    f = (typeof data === 'string' ? JSON.parse(data) : data) as Frame;
  } catch {
    return null;
  }
  if (!f || f.event !== 'postgres_changes') return null;
  const d = (f.payload as { data?: { table?: string; type?: string; record?: Record<string, unknown> } } | undefined)?.data;
  if (!d || !d.table || !d.record) return null;
  if (!(TABLES as readonly string[]).includes(d.table)) return null;
  if (d.type !== 'INSERT' && d.type !== 'UPDATE' && d.type !== 'DELETE') return null;
  return { table: d.table as Table, type: d.type, record: d.record };
}

export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
}

export interface RealtimeDeps {
  url: string;
  anonKey: string;
  getToken: (minValidityMs?: number) => Promise<string | null>;
  open?: (url: string) => WebSocketLike;
  /** Told when the channel is up (true) or down (false). */
  onState?: (up: boolean) => void;
}

const HEARTBEAT_MS = 25_000;
const TOKEN_REFRESH_MS = 25 * 60_000;
const RECONNECT_MIN_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;

export const realtimeSupported = (): boolean => typeof WebSocket !== 'undefined';

/** Subscribes to the five tables of one space. Returns a function that stops it. */
export function connectRealtime(deps: RealtimeDeps, spaceId: string, onChange: (c: RealtimeChange) => void): () => void {
  let stopped = false;
  let ws: WebSocketLike | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let tokenTimer: ReturnType<typeof setInterval> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let ref = 0;
  const topic = `realtime:sync-${spaceId}`;
  const next = () => String(++ref);

  const cleanup = () => {
    if (heartbeat) clearInterval(heartbeat);
    if (tokenTimer) clearInterval(tokenTimer);
    heartbeat = tokenTimer = null;
    if (ws) {
      ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    }
    ws = null;
  };

  const scheduleReconnect = () => {
    if (stopped || retry) return;
    deps.onState?.(false);
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** attempt++);
    retry = setTimeout(() => {
      retry = null;
      void connect();
    }, delay);
  };

  async function connect(): Promise<void> {
    if (stopped) return;
    cleanup();
    let token: string | null = null;
    try {
      token = await deps.getToken();
    } catch {
      token = null;
    }
    if (stopped) return;
    if (!token) return scheduleReconnect();
    const wsUrl = `${deps.url.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(deps.anonKey)}&vsn=1.0.0`;
    let socket: WebSocketLike;
    try {
      socket = deps.open ? deps.open(wsUrl) : (new WebSocket(wsUrl) as unknown as WebSocketLike);
    } catch {
      return scheduleReconnect();
    }
    ws = socket;
    socket.onopen = () => {
      attempt = 0;
      const config = {
        broadcast: { ack: false, self: false },
        presence: { key: '' },
        postgres_changes: TABLES.map((table) => ({ event: '*', schema: 'public', table, filter: `space_id=eq.${spaceId}` })),
      };
      socket.send(JSON.stringify({ topic, event: 'phx_join', payload: { config, access_token: token }, ref: next() }));
      heartbeat = setInterval(() => socket.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: next() })), HEARTBEAT_MS);
      tokenTimer = setInterval(() => {
        void deps
          .getToken(45 * 60_000)
          .then((t) => t && socket.send(JSON.stringify({ topic, event: 'access_token', payload: { access_token: t }, ref: next() })))
          .catch(() => {});
      }, TOKEN_REFRESH_MS);
    };
    socket.onmessage = (e) => {
      try {
        const frame = JSON.parse(String(e.data)) as Frame;
        if (frame.topic === topic && frame.event === 'phx_reply') {
          const status = (frame.payload as { status?: string } | undefined)?.status;
          deps.onState?.(status === 'ok');
          if (status !== 'ok') {
            cleanup();
            scheduleReconnect();
          }
          return;
        }
        if (frame.topic === topic && (frame.event === 'phx_error' || frame.event === 'phx_close')) {
          cleanup();
          scheduleReconnect();
          return;
        }
        const change = parseRealtimeFrame(frame);
        if (change) onChange(change);
      } catch {
        /* a malformed frame is ignored */
      }
    };
    socket.onerror = () => {};
    socket.onclose = () => {
      if (ws === socket) {
        cleanup();
        scheduleReconnect();
      }
    };
  }

  void connect();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    retry = null;
    cleanup();
    deps.onState?.(false);
  };
}
