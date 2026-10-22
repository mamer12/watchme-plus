/** localStorage that never throws (private mode, quota, disabled storage). */

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

function backend(): KV | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function readJson<T>(key: string, store: KV | null = backend()): T | null {
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Writes JSON; on quota errors evicts the oldest entries with `evictPrefix` and tries once more. */
export function writeJson(key: string, value: unknown, evictPrefix?: string, store: KV | null = backend()): boolean {
  if (!store) return false;
  const data = JSON.stringify(value);
  try {
    store.setItem(key, data);
    return true;
  } catch {
    if (!evictPrefix) return false;
    evictOldest(evictPrefix, store);
    try {
      store.setItem(key, data);
      return true;
    } catch {
      return false;
    }
  }
}

export function removeKey(key: string, store: KV | null = backend()): void {
  try {
    store?.removeItem(key);
  } catch {
    /* storage unavailable: nothing to remove */
  }
}

/** Drops the older half of the entries under `prefix` (entries carry a `t` timestamp). */
export function evictOldest(prefix: string, store: KV): void {
  const entries: { key: string; t: number }[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (!k || !k.startsWith(prefix)) continue;
    const v = readJson<{ t?: number }>(k, store);
    entries.push({ key: k, t: typeof v?.t === 'number' ? v.t : 0 });
  }
  entries.sort((a, b) => a.t - b.t);
  for (const e of entries.slice(0, Math.max(1, Math.ceil(entries.length / 2)))) store.removeItem(e.key);
}

/** In-memory KV, for tests. */
export function memoryStore(): KV {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}
