import { describe, expect, it } from 'vitest';
import { deviceNameFromUA, formatCode, isCompleteCode, joinErrorMessage, joinUrl, normalizeCode, parseJoinParam } from './codes';
import { readSyncConfig, syncEnabled } from './config';

describe('sync config and codes', () => {
  it('SYNC-001: is disabled unless both the https URL and the anon key are set', () => {
    expect(syncEnabled({})).toBe(false);
    expect(syncEnabled({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: '' })).toBe(false);
    expect(syncEnabled({ VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: 'k' })).toBe(false);
    expect(syncEnabled({ VITE_SUPABASE_URL: 'http://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'k' })).toBe(false);
    expect(readSyncConfig({ VITE_SUPABASE_URL: ' https://x.supabase.co/ ', VITE_SUPABASE_ANON_KEY: ' k ' })).toEqual({ url: 'https://x.supabase.co', anonKey: 'k' });
  });

  it('SYNC-002: normalises codes typed with spaces, dashes and lower case, and explains failures', () => {
    expect(normalizeCode('k7m2-qx4p ')).toBe('K7M2QX4P');
    expect(normalizeCode(' k7m2 qx4p')).toBe('K7M2QX4P');
    expect(normalizeCode('K7M2QX4PZZZ')).toBe('K7M2QX4P');
    expect(isCompleteCode('K7M2QX4P')).toBe(true);
    expect(isCompleteCode('K7M2QX4')).toBe(false);
    expect(isCompleteCode('K7M2QX4O')).toBe(false); // O is not in the alphabet
    expect(formatCode('K7M2QX4P')).toBe('K7M2-QX4P');
    expect(joinErrorMessage('wrong')).toMatch(/wrong, expired or already used/);
    expect(joinErrorMessage('too_many_attempts')).toMatch(/Too many wrong tries/);
    expect(joinErrorMessage('network')).toMatch(/connection/);
  });

  it('SYNC-003: builds and reads join links, ignoring incomplete codes', () => {
    expect(joinUrl('K7M2QX4P')).toBe('https://watch-me-plus.vercel.app/?join=K7M2QX4P');
    expect(parseJoinParam('?join=K7M2QX4P')).toBe('K7M2QX4P');
    expect(parseJoinParam('?a=1&join=k7m2-qx4p')).toBe('K7M2QX4P');
    expect(parseJoinParam('https://watch-me-plus.vercel.app/?join=K7M2QX4P#x')).toBe('K7M2QX4P');
    expect(parseJoinParam('?join=K7M2')).toBeNull();
    expect(parseJoinParam('')).toBeNull();
    expect(parseJoinParam('?other=K7M2QX4P')).toBeNull();
  });

  it('SYNC-004: proposes a device name from the user agent', () => {
    expect(deviceNameFromUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36')).toBe('Chrome on Windows');
    expect(deviceNameFromUA('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0')).toBe('Edge on Windows');
    expect(deviceNameFromUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15')).toBe('Safari on Mac');
    expect(deviceNameFromUA('Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0')).toBe('Firefox on Linux');
    expect(deviceNameFromUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1')).toBe('Phone');
    expect(deviceNameFromUA('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36')).toBe('Phone');
    expect(deviceNameFromUA('Mozilla/5.0 (Linux; Android 14; SM-X900) AppleWebKit/537.36 Chrome/126.0 Safari/537.36')).toBe('Tablet');
    expect(deviceNameFromUA('Mozilla/5.0 (SMART-TV; LINUX; Tizen 7.0) AppleWebKit/537.36 Chrome/94.0 TV Safari/537.36')).toBe('TV');
    expect(deviceNameFromUA('Mozilla/5.0 (Linux; Android 12; BRAVIA 4K) AppleWebKit/537.36 Chrome/110.0 Safari/537.36 Android TV')).toBe('TV');
  });
});
