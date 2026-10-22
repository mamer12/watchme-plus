/** Signing a TV in with the phone: the code in `/?tv=CODE`, kept only until it is approved, and what to say when it isn't. Pure. */
import { isCompleteCode, normalizeCode } from './codes';
import { SyncHttpError } from './types';

export const TV_KEY = 'wmp.tv';

export type ApproveError = 'wrong' | 'too_many_attempts' | 'network' | 'error';
export type ApproveResult = { ok: true } | { ok: false; error: ApproveError };

/** The whole code in `?tv=CODE` or `#tv=CODE`, or null when it is missing or not a whole code. */
export function parseTvParam(search: string, hash = ''): string | null {
  for (const part of [search, hash]) {
    try {
      const q = part.replace(/^[?#]/, '');
      const raw = new URLSearchParams(q).get('tv');
      if (!raw) continue;
      const code = normalizeCode(raw);
      if (isCompleteCode(code)) return code;
    } catch {
      /* try the next part */
    }
  }
  return null;
}

export interface TvStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export function readPendingTv(store: TvStore | null): string | null {
  try {
    const v = store?.getItem(TV_KEY);
    return v && isCompleteCode(v) ? v : null;
  } catch {
    return null;
  }
}

export function clearPendingTv(store: TvStore | null): void {
  try {
    store?.removeItem(TV_KEY);
  } catch {
    /* nothing kept */
  }
}

export interface TvLocation {
  search: string;
  hash: string;
  pathname: string;
}

/** Keeps a code found in the address (it survives sign-in redirects), strips it from the address and returns the code now pending. */
export function captureTvCode(loc: TvLocation, store: TvStore | null, replaceUrl: (url: string) => void): string | null {
  const found = parseTvParam(loc.search, loc.hash);
  if (found) {
    try {
      store?.setItem(TV_KEY, found);
    } catch {
      /* the dialog still shows for this page load only if storage works; nothing else to do */
    }
    try {
      const q = new URLSearchParams(loc.search.replace(/^\?/, ''));
      q.delete('tv');
      const h = new URLSearchParams(loc.hash.replace(/^#/, ''));
      h.delete('tv');
      const qs = q.toString();
      const hs = h.toString();
      replaceUrl(`${loc.pathname}${qs ? `?${qs}` : ''}${hs ? `#${hs}` : ''}`);
    } catch {
      /* the address stays as it is */
    }
    return found;
  }
  return readPendingTv(store);
}

export const sessionStore = (): TvStore | null => {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
};

/** Calls the backend and maps every outcome to a friendly result. */
export async function runApprove(api: { approveDeviceLogin(code: string): Promise<boolean> }, code: string): Promise<ApproveResult> {
  try {
    return (await api.approveDeviceLogin(code)) ? { ok: true } : { ok: false, error: 'wrong' };
  } catch (e) {
    if (e instanceof SyncHttpError) {
      if (e.message.includes('too_many_attempts')) return { ok: false, error: 'too_many_attempts' };
      if (e.status === 0) return { ok: false, error: 'network' };
    }
    return { ok: false, error: 'error' };
  }
}

export function approveErrorMessage(e: ApproveError): string {
  switch (e) {
    case 'wrong':
      return "That code didn't work. Ask the TV for a new QR code.";
    case 'too_many_attempts':
      return 'Too many wrong tries. Wait 10 minutes, then try again.';
    case 'network':
      return 'Could not reach the sync service. Check your connection and try again.';
    default:
      return 'Could not sign in your TV. Please try again.';
  }
}

export const APPROVED_MESSAGE = 'Your TV is signed in. You can close this.';
export const KIDS_MESSAGE = 'Kids profiles cannot sign in a TV. Switch to an adult profile, then scan the TV’s QR code again.';
export const groupTvCode = (code: string): string => (code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code);
