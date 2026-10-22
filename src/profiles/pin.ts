/** PIN hashing and lockout. Pure: the crypto is injected so tests don't need a browser. */
import { PIN_ITER, type PinRecord } from './types';

export interface PinCrypto {
  randomBytes(n: number): Uint8Array;
  /** PBKDF2-HMAC-SHA256, 32 bytes out. */
  pbkdf2(pin: string, salt: Uint8Array, iter: number): Promise<Uint8Array>;
}

export const MAX_TRIES = 5;
export const LOCK_MS = 5 * 60_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

export const isValidPin = (s: string): boolean => /^\d{4,6}$/.test(s);

export function toBase64(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array {
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array(0);
  }
}

/** Compares without stopping at the first difference. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** The browser's Web Crypto. Throws where it is missing (an insecure page). */
export function webCrypto(): PinCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error('crypto_unavailable');
  return {
    randomBytes: (n) => c.getRandomValues(new Uint8Array(n)),
    async pbkdf2(pin, salt, iter) {
      const key = await c.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
      return new Uint8Array(await c.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(salt), iterations: iter }, key, HASH_BYTES * 8));
    },
  };
}

export async function hashPin(pin: string, crypto: PinCrypto = webCrypto()): Promise<PinRecord> {
  if (!isValidPin(pin)) throw new Error('bad_pin');
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = await crypto.pbkdf2(pin, salt, PIN_ITER);
  return { salt: toBase64(salt), iter: PIN_ITER, hash: toBase64(hash) };
}

export async function verifyPin(pin: string, rec: PinRecord, crypto: PinCrypto = webCrypto()): Promise<boolean> {
  if (!isValidPin(pin) || !Number.isInteger(rec.iter) || rec.iter < 1 || rec.iter > 1_000_000) return false;
  const hash = await crypto.pbkdf2(pin, fromBase64(rec.salt), rec.iter);
  return constantTimeEqual(hash, fromBase64(rec.hash));
}

// ---- lockout ----------------------------------------------------------------------------------

export interface LockState {
  fails: number;
  /** epoch ms until which attempts are refused (0 = not locked) */
  until: number;
}

export const NO_LOCK: LockState = { fails: 0, until: 0 };

export const lockRemaining = (l: LockState, now: number): number => Math.max(0, l.until - now);

/** The lock state after one attempt. The fifth wrong try in a row locks for 5 minutes. */
export function afterAttempt(l: LockState, ok: boolean, now: number): LockState {
  if (ok) return NO_LOCK;
  const fails = (lockRemaining(l, now) > 0 ? 0 : l.fails) + 1;
  return fails >= MAX_TRIES ? { fails: 0, until: now + LOCK_MS } : { fails, until: 0 };
}
