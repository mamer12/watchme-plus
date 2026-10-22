import { describe, expect, it } from 'vitest';
import { askTonight, failReason, type AskDeps } from './api';
import type { TasteSummary } from './tasteSummary';

const summary: TasteSummary = { genres: [], lang: 'en', eras: {}, recent: [], liked: [], disliked: [], ctx: { weekday: 'monday', hour: 20, isWeekendEve: false } };
const config = { url: 'https://x.supabase.co', anonKey: 'anon' };
const msgs = [{ role: 'user' as const, text: 'hi' }];
const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });
const deps = (over: Partial<AskDeps> = {}): AskDeps => ({ config, getToken: async () => 'jwt', fetch: reply(200, { ok: true, say: 'Who is watching?', choices: ['Me'], filters: null }) as typeof fetch, ...over });

describe('Tonight api client', () => {
  it('TONIGHT-012: returns a validated reply and sends the user token to the function', async () => {
    let seen: { url: string; auth: string | null; body: string } | null = null;
    const f: typeof fetch = async (url, init) => {
      seen = { url: String(url), auth: new Headers(init?.headers).get('Authorization'), body: String(init?.body) };
      return new Response(JSON.stringify({ ok: true, say: 'Who is watching?', choices: ['Me'], filters: null }), { status: 200 });
    };
    const r = await askTonight(msgs, summary, deps({ fetch: f }));
    expect(r).toEqual({ ok: true, reply: { say: 'Who is watching?', choices: ['Me'], filters: null } });
    expect(seen).toMatchObject({ url: 'https://x.supabase.co/functions/v1/spark-tonight', auth: 'Bearer jwt' });
  });

  it('TONIGHT-012: every failure becomes a reason so the app can use the fixed questions', async () => {
    expect(await askTonight(msgs, summary, deps({ config: null }))).toEqual({ ok: false, reason: 'not_configured' });
    expect(await askTonight(msgs, summary, deps({ getToken: async () => null }))).toEqual({ ok: false, reason: 'no_session' });
    expect(await askTonight(msgs, summary, deps({ getToken: async () => { throw new Error('x'); } }))).toEqual({ ok: false, reason: 'no_session' });
    expect(await askTonight(msgs, summary, deps({ fetch: reply(429, { ok: false, reason: 'rate_limited' }) as typeof fetch }))).toEqual({ ok: false, reason: 'rate_limited' });
    expect(await askTonight(msgs, summary, deps({ fetch: reply(503, { ok: false, reason: 'not_configured' }) as typeof fetch }))).toEqual({ ok: false, reason: 'not_configured' });
    expect(await askTonight(msgs, summary, deps({ fetch: reply(200, { ok: true, say: '' }) as typeof fetch }))).toEqual({ ok: false, reason: 'bad_response' });
    expect(await askTonight(msgs, summary, deps({ fetch: (async () => { throw new TypeError('offline'); }) as typeof fetch }))).toEqual({ ok: false, reason: 'unavailable' });
    const hang: typeof fetch = (_u, init) => new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' }))));
    expect(await askTonight(msgs, summary, deps({ fetch: hang, timeoutMs: 10 }))).toEqual({ ok: false, reason: 'timeout' });
    expect(failReason(404, undefined)).toBe('not_configured');
    expect(failReason(500, 'weird')).toBe('unavailable');
  });
});
