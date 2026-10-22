import { describe, expect, it } from 'vitest';
import { capabilities } from '../profiles/logic';
import { isCompleteCode, normalizeCode } from './codes';
import { SyncClient } from './client';
import { SyncHttpError } from './types';
import { KIDS_MESSAGE, approveErrorMessage, captureTvCode, groupTvCode, parseTvParam, readPendingTv, runApprove, TV_KEY, type TvStore } from './tvLogin';

const mem = (): TvStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};
const fail = (status: number, message: string) => ({ approveDeviceLogin: async () => Promise.reject(new SyncHttpError(status, message)) });

describe('sign in a TV', () => {
  it('ACC-018: captures ?tv= and #tv=, keeps it in session storage and strips it from the address', () => {
    const store = mem();
    let url = '';
    expect(captureTvCode({ pathname: '/', search: '?tv=abcd-efgh&x=1', hash: '' }, store, (u) => (url = u))).toBe('ABCDEFGH');
    expect(url).toBe('/?x=1');
    expect(store.data.get(TV_KEY)).toBe('ABCDEFGH');
    const s2 = mem();
    expect(captureTvCode({ pathname: '/', search: '', hash: '#tv=ABCD%20EFGH' }, s2, (u) => (url = u))).toBe('ABCDEFGH');
    expect(url).toBe('/');
    // a later page load without the code still has it pending
    expect(captureTvCode({ pathname: '/', search: '', hash: '' }, s2, () => {})).toBe('ABCDEFGH');
  });

  it('ACC-018: ignores partial, invalid or missing codes', () => {
    expect(parseTvParam('?tv=ABCD')).toBeNull();
    expect(parseTvParam('?tv=ABCDEFG0')).toBeNull(); // 0 is not in the alphabet
    expect(parseTvParam('')).toBeNull();
    const store = mem();
    expect(captureTvCode({ pathname: '/', search: '?tv=ABC', hash: '' }, store, () => {})).toBeNull();
    expect(readPendingTv(store)).toBeNull();
    expect(readPendingTv(null)).toBeNull();
  });

  it('ACC-019: calls approve_device_login through the sync client and shows the code grouped', async () => {
    const log: { url: string; body: string }[] = [];
    const client = new SyncClient({
      config: { url: 'https://api.example.test', anonKey: 'anon' },
      now: () => 0,
      loadSession: () => ({ accessToken: 'a', refreshToken: 'r', expiresAt: 9e12, userId: 'u' }),
      saveSession: () => {},
      fetch: (async (url: string, init: RequestInit) => {
        log.push({ url, body: String(init.body) });
        return { ok: true, status: 200, json: async () => true, text: async () => 'true' } as Response;
      }) as unknown as typeof fetch,
    });
    expect(await runApprove(client, 'ABCDEFGH')).toEqual({ ok: true });
    expect(log[0]).toEqual({ url: 'https://api.example.test/rest/v1/rpc/approve_device_login', body: '{"code":"ABCDEFGH"}' });
    expect(groupTvCode('ABCDEFGH')).toBe('ABCD EFGH');
  });

  it('ACC-020: maps false, too_many_attempts, offline and other failures to friendly messages', async () => {
    expect(await runApprove({ approveDeviceLogin: async () => false }, 'ABCDEFGH')).toEqual({ ok: false, error: 'wrong' });
    expect(approveErrorMessage('wrong')).toBe("That code didn't work. Ask the TV for a new QR code.");
    expect(await runApprove(fail(400, 'too_many_attempts'), 'ABCDEFGH')).toEqual({ ok: false, error: 'too_many_attempts' });
    expect(approveErrorMessage('too_many_attempts')).toMatch(/Wait 10 minutes/);
    expect(await runApprove(fail(0, 'Failed to fetch'), 'ABCDEFGH')).toEqual({ ok: false, error: 'network' });
    expect(approveErrorMessage('network')).toMatch(/connection/);
    const other = await runApprove(fail(500, 'secret server text'), 'ABCDEFGH');
    expect(other).toEqual({ ok: false, error: 'error' });
    expect(approveErrorMessage('error')).not.toMatch(/secret/);
  });

  it('ACC-021: the pending code survives a reload while signed out', () => {
    const store = mem();
    captureTvCode({ pathname: '/', search: '?tv=ABCDEFGH', hash: '' }, store, () => {});
    // after sign-in the app reloads at "/": nothing in the address, the code is still there
    expect(captureTvCode({ pathname: '/', search: '', hash: '' }, store, () => {})).toBe('ABCDEFGH');
  });

  it('ACC-022: a typed code is normalised like pairing codes', () => {
    expect(normalizeCode('abcd efgh')).toBe('ABCDEFGH');
    expect(isCompleteCode(normalizeCode('abcd-efgh '))).toBe(true);
    expect(isCompleteCode(normalizeCode('abcd-ef'))).toBe(false);
  });

  it('ACC-023: Kids profiles cannot sign in a TV', () => {
    expect(capabilities({ kids: true }).sync).toBe(false);
    expect(capabilities({ kids: false }).sync).toBe(true);
    expect(KIDS_MESSAGE).toMatch(/adult profile/);
  });
});
