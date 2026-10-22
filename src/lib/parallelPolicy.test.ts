import { describe, expect, it } from 'vitest';
import { createParallelFetcher } from './parallelFetcher';
import { PF_TIMING, isTimeout, pieceFailureAction, remainingSpan, timeoutError } from './parallelPolicy';
import { PF } from './parallelRange';

const ORIGINAL = 'https://cdn.cee.buzz/v/a.mp4?Expires=4102444800&Signature=x';
const byteAt = (i: number) => i % 251;

/** A file server whose behaviour per request is scripted; it honours the abort signal like fetch does. */
function server(size: number, script: (n: number, a: number) => 'ok' | 'hang' | 'hang-body' | 'net' | 'drop') {
  const calls: { range: string; aborted: () => boolean }[] = [];
  let heads = 0;
  const impl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal ?? undefined;
    if (init?.method === 'HEAD') {
      heads += 1;
      return new Response(null, { headers: { 'Content-Length': String(size), 'Content-Type': 'video/mp4' } });
    }
    const range = new Headers(init?.headers).get('range') ?? '';
    calls.push({ range, aborted: () => !!signal?.aborted });
    const m = /bytes=(\d+)-(\d+)/.exec(range)!;
    const a = Number(m[1]);
    const b = Math.min(Number(m[2]), size - 1);
    const how = script(calls.length, a);
    const rejectOnAbort = new Promise<never>((_, rej) => signal?.addEventListener('abort', () => rej(signal.reason ?? Object.assign(new Error('a'), { name: 'AbortError' }))));
    rejectOnAbort.catch(() => {});
    if (how === 'net') throw new TypeError('network');
    if (how === 'hang') await rejectOnAbort;
    const bytes = Uint8Array.from({ length: b - a + 1 }, (_, i) => byteAt(a + i));
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        signal?.addEventListener('abort', () => c.error(signal.reason ?? Object.assign(new Error('a'), { name: 'AbortError' })));
        if (how === 'hang-body') return c.enqueue(bytes.slice(0, 3)); // then silence
        if (how === 'drop') {
          c.enqueue(bytes.slice(0, 3));
          setTimeout(() => c.error(new TypeError('reset')), 5);
          return;
        }
        c.enqueue(bytes);
        c.close();
      },
    });
    return new Response(body, { status: 206, headers: { 'Content-Length': String(b - a + 1) } });
  }) as typeof fetch;
  return { impl, calls, heads: () => heads };
}
const ask = (range: string, signal = new AbortController().signal) => ({ url: ORIGINAL, range, signal });
const read = async (res: Response) => new Uint8Array(await res.arrayBuffer());
const expectBytes = (got: Uint8Array, a: number) => {
  for (let i = 0; i < got.length; i++) if (got[i] !== byteAt(a + i)) throw new Error(`byte ${i} differs`);
};

describe('retry and timeout policy', () => {
  it('PERF-018: first byte allowance is at least 8 s and a body may stay silent at least 20 s', () => {
    expect(PF_TIMING.CONNECT_MS).toBeGreaterThanOrEqual(8000);
    expect(PF_TIMING.STALL_MS).toBeGreaterThanOrEqual(20_000);
  });

  it('PERF-018: a timeout is not an abort; a cancelled request is never retried', () => {
    expect(isTimeout(timeoutError('stall'))).toBe(true);
    expect(isTimeout(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(false);
    const base = { attempts: 0, retries: 1, canFallback: true };
    expect(pieceFailureAction({ ...base, aborted: true })).toBe('abort');
    expect(pieceFailureAction({ ...base, aborted: false })).toBe('retry');
    expect(pieceFailureAction({ ...base, aborted: false, attempts: 1 })).toBe('fallback');
    expect(pieceFailureAction({ ...base, aborted: false, attempts: 1, canFallback: false })).toBe('fail');
  });

  it('PERF-018: the remaining span runs from the byte a piece reached to the end of the last piece', () => {
    const ranges = [{ start: 0, end: 9 }, { start: 10, end: 19 }, { start: 20, end: 29 }];
    expect(remainingSpan(ranges, 1, 4)).toEqual({ start: 14, end: 29 });
    expect(remainingSpan(ranges, 2, 10)).toBeNull();
  });

  it('PERF-018: a piece that times out is retried once on a new connection and the bytes are complete', async () => {
    const srv = server(4000, (n, a) => (a === 1000 && n <= 4 ? 'hang-body' : 'ok'));
    const f = createParallelFetcher({ fetch: srv.impl, stallMs: 30, connectMs: 30 });
    const res = (await f.respond(ask('bytes=0-3999')))!;
    const body = await read(res);
    expect(body.length).toBe(4000);
    expectBytes(body, 0);
  });

  it('PERF-018: a piece that keeps failing falls back to one plain request for the rest instead of failing', async () => {
    // Piece at 1000 hangs on every pieces-mode attempt; the fallback request starts at 1006 with a wider range.
    const srv = server(4000, (_n, a) => (a === 1000 || a === 1003 ? 'hang-body' : 'ok'));
    const f = createParallelFetcher({ fetch: srv.impl, stallMs: 30, connectMs: 30 });
    const body = await read((await f.respond(ask('bytes=0-3999')))!);
    expect(body.length).toBe(4000);
    expectBytes(body, 0);
    expect(srv.calls.some((c) => c.range === 'bytes=1006-3999')).toBe(true);
  });

  it('PERF-018: a first piece that never answers times out and hands the request back to the plain path', async () => {
    const srv = server(4000, () => 'hang');
    const f = createParallelFetcher({ fetch: srv.impl, stallMs: 30, connectMs: 20 });
    expect(await f.respond(ask('bytes=0-3999'))).toBeNull();
    expect(srv.calls.length).toBe(PF.RETRIES + 1);
  });
});

describe('cancelled requests', () => {
  it('PERF-019: a cancelled response aborts every piece connection at once and frees the budget', async () => {
    const srv = server(4_000_000, (_n, a) => (a === 0 ? 'ok' : 'hang-body'));
    const f = createParallelFetcher({ fetch: srv.impl, stallMs: 5000 });
    const res = (await f.respond(ask('bytes=0-')))!;
    await res.body!.cancel();
    await new Promise((r) => setTimeout(r, 20));
    expect(srv.calls.slice(1).every((c) => c.aborted())).toBe(true);
  });

  it('PERF-019: aborting before the answer rejects quietly and starts no piece', async () => {
    const srv = server(4000, () => 'ok');
    const ctl = new AbortController();
    ctl.abort();
    const f = createParallelFetcher({ fetch: srv.impl });
    await expect(f.respond(ask('bytes=0-3999', ctl.signal))).rejects.toMatchObject({ name: 'AbortError' });
    expect(srv.calls.length).toBe(0);
  });

  it('PERF-019: the file host and size are asked once per file', async () => {
    const srv = server(4000, () => 'ok');
    const f = createParallelFetcher({ fetch: srv.impl });
    await read((await f.respond(ask('bytes=0-999')))!);
    await read((await f.respond(ask('bytes=1000-1999')))!);
    expect(srv.heads()).toBe(1);
  });
});
