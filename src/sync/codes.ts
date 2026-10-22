/** Pairing-code input, join links and a default device name. All pure. */

/** The characters pairing codes use (no 0 O 1 I L). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 8;
export const PAIRING_TTL_MS = 10 * 60 * 1000;
export const JOIN_ORIGIN = 'https://watch-me-plus.vercel.app';

/** "k7m2 qx4p", "K7M2-QX4P" and "k7m2qx4p" all become "K7M2QX4P". Anything else that isn't a letter or digit is dropped. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

export const isCompleteCode = (code: string): boolean => code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c));

/** "K7M2QX4P" → "K7M2-QX4P", for reading aloud. */
export const formatCode = (code: string): string => (code.length === CODE_LENGTH ? `${code.slice(0, 4)}-${code.slice(4)}` : code);

export const joinUrl = (code: string): string => `${JOIN_ORIGIN}/?join=${encodeURIComponent(code)}`;

/** The code in `?join=CODE` (a query string or a full URL), or null when it is missing or not a whole code. */
export function parseJoinParam(search: string): string | null {
  try {
    const q = search.includes('?') ? search.slice(search.indexOf('?')) : search.startsWith('join=') ? `?${search}` : search;
    const raw = new URLSearchParams(q).get('join');
    if (!raw) return null;
    const code = normalizeCode(raw);
    return isCompleteCode(code) ? code : null;
  } catch {
    return null;
  }
}

/** What to say for a join attempt that failed. */
export function joinErrorMessage(error: string): string {
  switch (error) {
    case 'wrong':
      return 'That code is wrong, expired or already used. Ask for a new one on the other device.';
    case 'too_many_attempts':
      return 'Too many wrong tries. Wait 10 minutes, then try again.';
    case 'network':
      return 'Could not reach the sync service. Check your connection and try again.';
    default:
      return 'Could not join. Please try again.';
  }
}

export interface DeviceHints {
  /** `navigator.maxTouchPoints` */
  touchPoints?: number;
}

/** "Chrome on Windows", "Phone", "Tablet" or "TV". */
export function deviceNameFromUA(ua: string, hints: DeviceHints = {}): string {
  if (/smart-?tv|tizen|web0s|webos|hbbtv|netfx|bravia|crkey|googletv|android tv|aft[a-z]|appletv|roku|vizio/i.test(ua)) return 'TV';
  if (/iphone|ipod|android.+mobile|windows phone/i.test(ua)) return 'Phone';
  if (/ipad|android|tablet/i.test(ua) || (/macintosh/i.test(ua) && (hints.touchPoints ?? 0) > 1)) return 'Tablet';
  const browser = /edg\//i.test(ua) ? 'Edge' : /opr\/|opera/i.test(ua) ? 'Opera' : /firefox\//i.test(ua) ? 'Firefox' : /chrome\/|crios/i.test(ua) ? 'Chrome' : /safari\//i.test(ua) ? 'Safari' : 'Browser';
  const os = /windows/i.test(ua) ? 'Windows' : /cros/i.test(ua) ? 'ChromeOS' : /mac os|macintosh/i.test(ua) ? 'Mac' : /linux|x11/i.test(ua) ? 'Linux' : 'this device';
  return `${browser} on ${os}`;
}

export const cleanDeviceName = (name: string): string => name.replace(/\s+/g, ' ').trim().slice(0, 60);
