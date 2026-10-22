import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import handler, { buildUpstream, rateLimited } from '../../api/tmdb';

function fakeRes() {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    body: '',
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = v;
    },
    end(b: string) {
      res.body = b;
    },
  };
  return { res, headers };
}

describe('tmdb proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('TMDB-001: allows only /find/, /movie/, /tv/, /trending/ and /discover/ paths', () => {
    expect(buildUpstream('/find/tt0111161?external_source=imdb_id', 'k').ok).toBe(true);
    expect(buildUpstream('/movie/550/images', 'k').ok).toBe(true);
    expect(buildUpstream('/tv/1396/recommendations', 'k').ok).toBe(true);
    expect(buildUpstream('/trending/movie/week', 'k').ok).toBe(true);
    expect(buildUpstream('/discover/movie?sort_by=vote_count.desc&with_genres=28|12&page=1', 'k').ok).toBe(true);
    expect(buildUpstream('/discover/movie?x=<script>', 'k').ok).toBe(false);
    expect(buildUpstream('/account', 'k')).toMatchObject({ ok: false, status: 403 });
    expect(buildUpstream('/movie/../account', 'k')).toMatchObject({ ok: false, status: 400 });
    expect(buildUpstream('//evil.com/movie/1', 'k')).toMatchObject({ ok: false, status: 400 });
    expect(buildUpstream('https://evil.com/movie/1', 'k')).toMatchObject({ ok: false, status: 400 });
    expect(buildUpstream('', 'k')).toMatchObject({ ok: false, status: 400 });
  });

  it('TMDB-002: sends a v4 token as Bearer and a v3 key as api_key, never forwarding a client api_key', () => {
    const v4 = buildUpstream('/movie/1?api_key=stolen', 'eyJabc');
    expect(v4.ok && v4.headers.Authorization).toBe('Bearer eyJabc');
    expect(v4.ok && v4.url).not.toContain('api_key');
    const v3 = buildUpstream('/movie/1?language=en', 'abc123');
    expect(v3.ok && v3.url).toBe('https://api.themoviedb.org/3/movie/1?language=en&api_key=abc123');
    expect(v3.ok && v3.headers.Authorization).toBeUndefined();
  });

  it('TMDB-003: answers 503 without a key and caches successes at the edge for a day', async () => {
    const missing = fakeRes();
    vi.stubEnv('TMDB_KEY', '');
    await handler({ method: 'GET', url: '/api/tmdb?path=/movie/1', headers: {} } as unknown as IncomingMessage, missing.res as unknown as ServerResponse);
    expect(missing.res.statusCode).toBe(503);

    vi.stubEnv('TMDB_KEY', 'abc');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"id":1}', { status: 200 })));
    const ok = fakeRes();
    await handler({ method: 'GET', url: '/api/tmdb?path=%2Fmovie%2F1', headers: {} } as unknown as IncomingMessage, ok.res as unknown as ServerResponse);
    expect(ok.res.statusCode).toBe(200);
    expect(ok.res.body).toBe('{"id":1}');
    expect(ok.headers['cache-control']).toContain('s-maxage=86400');
    expect(ok.headers['cache-control']).toContain('stale-while-revalidate');
  });

  it('TMDB-004: rate-limits a single client and hides upstream failures', async () => {
    let limited = false;
    for (let i = 0; i < 300; i++) limited = rateLimited('1.2.3.4', 1000);
    expect(limited).toBe(true);
    expect(rateLimited('5.6.7.8', 1000)).toBe(false);

    vi.stubEnv('TMDB_KEY', 'abc');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('secret details', { status: 500 })));
    const r = fakeRes();
    await handler({ method: 'GET', url: '/api/tmdb?path=/movie/1', headers: { 'x-forwarded-for': '9.9.9.9' } } as unknown as IncomingMessage, r.res as unknown as ServerResponse);
    expect(r.res.statusCode).toBe(502);
    expect(r.res.body).not.toContain('secret');
  });
});
