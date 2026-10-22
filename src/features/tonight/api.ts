/** Calls the spark-tonight Edge Function. Every failure becomes a reason; the app then uses the fixed questions. */
import { sanitizeReply } from '../../../supabase/functions/spark-tonight/validate';
import { readSyncConfig, type SyncConfig } from '../../sync/config';
import { loadSync } from '../../sync/syncStorage';
import type { ChatMsg, FailReason, TonightReply } from './types';
import type { TasteSummary } from './tasteSummary';

export const TIMEOUT_MS = 20_000;

export type AskResult = { ok: true; reply: TonightReply } | { ok: false; reason: FailReason };

export interface AskDeps {
  config: SyncConfig | null;
  /** A valid access token, or null when this browser has no session. */
  getToken: () => Promise<string | null>;
  fetch: typeof fetch;
  timeoutMs?: number;
}

const KNOWN: FailReason[] = ['not_configured', 'rate_limited', 'unauthorized', 'too_many_turns', 'model_error'];

/** Maps a server `reason` (or HTTP status) to a FailReason. */
export function failReason(status: number, reason: unknown): FailReason {
  if (typeof reason === 'string' && (KNOWN as string[]).includes(reason)) return reason as FailReason;
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rate_limited';
  if (status === 404) return 'not_configured';
  return 'unavailable';
}

export async function askTonight(messages: ChatMsg[], summary: TasteSummary, d: AskDeps): Promise<AskResult> {
  if (!d.config) return { ok: false, reason: 'not_configured' };
  let token: string | null = null;
  try {
    token = await d.getToken();
  } catch {
    token = null;
  }
  if (!token) return { ok: false, reason: 'no_session' };

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), d.timeoutMs ?? TIMEOUT_MS);
  try {
    const res = await d.fetch(`${d.config.url}/functions/v1/spark-tonight`, {
      method: 'POST',
      headers: { apikey: d.config.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, summary }),
      signal: ctl.signal,
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* not JSON */
    }
    const rec = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    if (!res.ok || rec.ok === false) return { ok: false, reason: failReason(res.status, rec.reason) };
    const checked = sanitizeReply(rec);
    return checked.ok ? { ok: true, reply: checked.value } : { ok: false, reason: 'bad_response' };
  } catch (e) {
    return { ok: false, reason: e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

/** The app's real dependencies: the sync backend's URL and the signed-in (guest or account) session. */
export function realDeps(): AskDeps {
  return {
    config: readSyncConfig(),
    fetch: (...a) => fetch(...a),
    getToken: async () => {
      if (!loadSync().session) return null;
      const { loadSyncService } = await import('../../sync/runtime');
      return (await loadSyncService()).client.accessToken();
    },
  };
}
