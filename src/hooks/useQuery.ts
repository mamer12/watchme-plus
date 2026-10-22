import { useEffect, useRef, useState } from 'react';
import { useIsp } from './useIsp';

interface QueryState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
}

interface Stored {
  key: string | null;
  data: unknown;
  error: unknown;
  settled: boolean;
}

/** Answers younger than this are reused without asking again (rows and details don't change by the minute). */
export const QUERY_STALE_MS = 8 * 60_000;

const cache = new Map<string, { t: number; data: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

/**
 * Runs `fn` for `key` and remembers the answer for the session, so going back to a page renders
 * instantly. A null key skips the query. Answers always belong to the current key.
 */
export function useQuery<T>(rawKey: string | null, fn: () => Promise<T>): QueryState<T> {
  // Answers belong to the provider that served them, so a switch reloads everything.
  const isp = useIsp();
  const key = rawKey === null ? null : `${isp}|${rawKey}`;
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const [state, setState] = useState<Stored>({ key: null, data: undefined, error: null, settled: false });

  useEffect(() => {
    if (key === null) return;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.t < QUERY_STALE_MS) return;
    let alive = true;
    let p = inflight.get(key) as Promise<T> | undefined;
    if (!p) {
      p = fnRef.current();
      inflight.set(key, p);
      p.then(
        (data) => void cache.set(key, { t: Date.now(), data }),
        () => undefined,
      ).finally(() => inflight.delete(key));
    }
    p.then(
      (data) => alive && setState({ key, data, error: null, settled: true }),
      (error: unknown) => alive && setState({ key, data: undefined, error, settled: true }),
    );
    return () => {
      alive = false;
    };
  }, [key]);

  if (key === null) return { data: undefined, error: null, loading: false };
  const own = state.key === key;
  const data = (own && state.data !== undefined ? state.data : cache.get(key)?.data) as T | undefined;
  return { data, error: own ? state.error : null, loading: data === undefined && !(own && state.settled) };
}

export function invalidateQueries(prefix = ''): void {
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
}
