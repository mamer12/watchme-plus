/**
 * TMDB proxy (Vercel Node function). GET /api/tmdb?path=/find/tt123?external_source=imdb_id
 * Keeps TMDB_KEY on the server, allow-lists paths and lets Vercel's edge cache the answers.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

export const TMDB_BASE = 'https://api.themoviedb.org/3';
export const ALLOWED_PREFIXES = ['/find/', '/movie/', '/tv/', '/trending/', '/discover/'] as const;
const SAFE_PATH = /^\/[A-Za-z0-9/_\-.?=&,|]+$/;
const MAX_PATH_LENGTH = 300;
const RATE_LIMIT = 240; // requests per IP per window, per function instance
const RATE_WINDOW_MS = 60_000;
const UPSTREAM_TIMEOUT_MS = 8_000;

export type ProxyTarget = { ok: true; url: string; headers: Record<string, string> } | { ok: false; status: number; error: string };

/** Validates the requested path and builds the upstream URL + auth. Pure, unit tested. */
export function buildUpstream(rawPath: string | null | undefined, key: string | undefined): ProxyTarget {
  if (!key) return { ok: false, status: 503, error: 'TMDB is not configured' };
  const path = (rawPath ?? '').trim();
  if (!path || path.length > MAX_PATH_LENGTH || !SAFE_PATH.test(path) || path.includes('..') || path.includes('//')) {
    return { ok: false, status: 400, error: 'Invalid path' };
  }
  if (!ALLOWED_PREFIXES.some((p) => path.startsWith(p))) return { ok: false, status: 403, error: 'Path not allowed' };

  let url: URL;
  try {
    url = new URL(TMDB_BASE + path);
  } catch {
    return { ok: false, status: 400, error: 'Invalid path' };
  }
  if (url.origin !== 'https://api.themoviedb.org' || !url.pathname.startsWith('/3/')) {
    return { ok: false, status: 400, error: 'Invalid path' };
  }
  url.searchParams.delete('api_key');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  else url.searchParams.set('api_key', key);
  return { ok: true, url: url.toString(), headers };
}

const hits = new Map<string, { count: number; start: number }>();

/** Small per-instance limiter; the CDN cache absorbs most traffic anyway. */
export function rateLimited(ip: string, now = Date.now()): boolean {
  const entry = hits.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW_MS) {
    hits.set(ip, { count: 1, start: now });
    if (hits.size > 5000) hits.clear();
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

function send(res: ServerResponse, status: number, body: unknown, cache: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, { error: 'Method not allowed' }, 'no-store');
    return;
  }
  const forwarded = req.headers['x-forwarded-for'];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() || 'unknown';
  if (rateLimited(ip)) {
    send(res, 429, { error: 'Too many requests' }, 'no-store');
    return;
  }

  const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
  const target = buildUpstream(query.get('path'), process.env.TMDB_KEY);
  if (!target.ok) {
    send(res, target.status, { error: target.error }, 'public, s-maxage=60');
    return;
  }

  try {
    const upstream = await fetch(target.url, {
      headers: target.headers,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const text = await upstream.text();
    if (!upstream.ok) {
      // Don't leak upstream details; 404s are cached briefly, the rest not at all.
      const cache = upstream.status === 404 ? 'public, s-maxage=3600' : 'no-store';
      send(res, upstream.status === 404 ? 404 : 502, { error: 'Upstream error' }, cache);
      return;
    }
    send(res, 200, text, 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
  } catch (err) {
    console.error('tmdb proxy failed', err instanceof Error ? err.message : err);
    send(res, 504, { error: 'Upstream unavailable' }, 'no-store');
  }
}
