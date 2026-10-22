/** Checks a typed PIN against one or more records, with the persisted lockout (5 wrong tries, 5 minutes). */
import { readJson, writeJson, type KV } from '../lib/storage';
import { LOCK_KEY } from './persist';
import { afterAttempt, lockRemaining, MAX_TRIES, NO_LOCK, verifyPin, type LockState, type PinCrypto } from './pin';
import type { PinRecord } from './types';

export type PinResult = { ok: true } | { ok: false; locked: true; remainingMs: number } | { ok: false; locked: false; triesLeft: number };

export interface GateDeps {
  kv: KV | null | undefined;
  now: () => number;
  crypto?: PinCrypto;
}

type Locks = Record<string, LockState>;

const readLocks = (kv: KV | null | undefined): Locks => readJson<Locks>(LOCK_KEY, kv) ?? {};

export function lockLeft(lockKey: string, deps: Pick<GateDeps, 'kv' | 'now'>): number {
  return lockRemaining(readLocks(deps.kv)[lockKey] ?? NO_LOCK, deps.now());
}

/** `lockKey` is the profile id, or 'guardian' for "any adult's PIN". */
export async function checkPin(pin: string, targets: PinRecord[], lockKey: string, deps: GateDeps): Promise<PinResult> {
  const now = deps.now();
  const locks = readLocks(deps.kv);
  const cur = locks[lockKey] ?? NO_LOCK;
  const left = lockRemaining(cur, now);
  if (left > 0) return { ok: false, locked: true, remainingMs: left };
  let ok = false;
  for (const rec of targets) {
    // Every record is checked, so the time taken doesn't say which one matched.
    if (await verifyPin(pin, rec, deps.crypto)) ok = true;
  }
  const next = afterAttempt(cur, ok, now);
  const rest = { ...locks };
  if (next.fails === 0 && next.until === 0) delete rest[lockKey];
  else rest[lockKey] = next;
  writeJson(LOCK_KEY, rest, undefined, deps.kv);
  if (ok) return { ok: true };
  const remainingMs = lockRemaining(next, now);
  return remainingMs > 0 ? { ok: false, locked: true, remainingMs } : { ok: false, locked: false, triesLeft: MAX_TRIES - next.fails };
}
