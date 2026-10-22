/**
 * JSON fetching with retries, backoff, in-flight de-duplication, a short memory cache and a
 * last-good copy in localStorage so the UI is never empty when the API hiccups.
 */
import { readJson, removeKey, writeJson, type KV } from '../lib/storage';
import { apiBase } from './endpoints';
import { reportCatalogFailure, reportCatalogOk } from './health';

export const CACHE_PREFIX = 'wmp:api:';
const MEMORY_TTL_MS = 8 * 60_000;
const DEFAULT_RETRIES = 3;
const BASE_DELAY_MS = 400;
const TIMEOUT_MS = 15_000;

interface Cached {
  t: number;
  v: unknown;
}

export interface FetchOptions {
  retries?: number;
  /** Persist the last good answer in localStorage (default true). */
  persist?: boolean;
  fetchImpl?: typeof fetch;
  store?: KV | null;
  sleep?: (ms: number) => Promise<void>;
}

const memory = new Map<string, Cached>();
const inflight = new Map<string, Promise<unknown>>();

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class ApiError extends Error {
  constructor(
    message: string,
    readonly url: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Parses a body that should be JSON; HTML error pages and empty bodies count as failures. */
export function parseBody(text: string): unknown {
  const t = text.replace(/^﻿/, '').trim();
  if (!t || t.startsWith('<')) throw new Error('Not JSON');
  return JSON.parse(t);
}

async function attempt(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
  try {
    const res = await fetchImpl(url, { signal: ctrl?.signal, credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseBody(await res.text());
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** A request that never got an answer (offline, blocked, DNS, timeout), as opposed to an HTTP or JSON error. */
export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof DOMException && err.name === 'AbortError');
}

/** Forgets every cached API answer (memory and localStorage). */
export function clearApiCache(store?: KV | null): void {
  memory.clear();
  inflight.clear();
  const kv = store === undefined ? safeLocal() : store;
  if (!kv) return;
  const drop: string[] = [];
  for (let i = 0; i < kv.length; i++) {
    const k = kv.key(i);
    if (k && k.startsWith(CACHE_PREFIX)) drop.push(k);
  }
  for (const k of drop) removeKey(k, kv);
}

function safeLocal(): KV | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Returns the freshest copy we have without touching the network. */
export function peekJson(url: string, store?: KV | null): unknown {
  const m = memory.get(url);
  if (m) return m.v;
  // An undefined store falls back to localStorage (default parameter).
  return readJson<Cached>(CACHE_PREFIX + url, store)?.v;
}

export async function fetchJson(url: string, opts: FetchOptions = {}): Promise<unknown> {
  const m = memory.get(url);
  if (m && Date.now() - m.t < MEMORY_TTL_MS) return m.v;
  const running = inflight.get(url);
  if (running) return running;

  const p = load(url, opts).finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}

async function load(url: string, opts: FetchOptions): Promise<unknown> {
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
  const sleep = opts.sleep ?? defaultSleep;
  const persist = opts.persist ?? true;
  const store = opts.store;
  let lastError: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      const v = await attempt(url, fetchImpl);
      const entry = { t: Date.now(), v };
      memory.set(url, entry);
      if (url.startsWith(apiBase())) reportCatalogOk();
      if (persist) writeJson(CACHE_PREFIX + url, entry, CACHE_PREFIX, store);
      return v;
    } catch (err) {
      lastError = err;
      if (i < retries) await sleep(BASE_DELAY_MS * 2 ** i);
    }
  }
  if (url.startsWith(apiBase()) && isNetworkError(lastError)) reportCatalogFailure();
  const saved = peekJson(url, store);
  if (saved !== undefined) return saved;
  throw new ApiError(lastError instanceof Error ? lastError.message : 'Request failed', url);
}

/** For tests. */
export function clearMemoryCache(): void {
  memory.clear();
  inflight.clear();
}
