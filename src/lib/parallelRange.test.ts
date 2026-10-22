import { describe, expect, it } from 'vitest';
import { clampSpan, createLimiter, fileHostUrl, isMirrorMediaHost, orderedPieceStream, parseContentRange, parseRange, PF, shouldParallelize, splitSpan, type ByteRange } from './parallelRange';
import { createParallelFetcher } from './parallelFetcher';
import { pfAllowed, pfWanted } from './pfState';

const ORIGINAL = 'https://cdn.cee.buzz/v/a.mp4?Expires=4102444800&Signature=x';

/** A fake file server: answers 206 for ranges of `size` bytes whose byte i is i % 251. */
function fakeServer(size: number, opts: { fail?: (n: number, range: string) => number | 'net' | null; delay?: (start: number) => number; noRange?: boolean } = {}) {
  const calls: { url: string; range: string }[] = [];
  let active = 0;
  let maxActive = 0;
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const range = new Headers(init?.headers).get('range') ?? '';
    calls.push({ url, range });
    if (init?.method === 'HEAD') {
      const hf = opts.fail?.(calls.length, 'HEAD');
      if (hf === 'net') throw new TypeError('network');
      if (typeof hf === 'number') return new Response(null, { status: hf });
      return new Response(null, { status: 200, headers: { 'Content-Length': String(size), 'Content-Type': 'video/mp4' } });
    }
    const f = opts.fail?.(calls.length, range);
    if (f === 'net') throw new TypeError('network');
    if (typeof f === 'number') return new Response('x', { status: f });
    const m = /bytes=(\d+)-(\d+)/.exec(range)!;
    const a = Number(m[1]);
    if (opts.noRange) return new Response(new Uint8Array(10), { status: 200 });
    if (a >= size) return new Response('', { status: 416 });
    const b = Math.min(Number(m[2]), size - 1);
    const bytes = Uint8Array.from({ length: b - a + 1 }, (_, i) => (a + i) % 251);
    active += 1;
    maxActive = Math.max(maxActive, active);
    const wait = opts.delay?.(a) ?? 0;
    const body = new ReadableStream<Uint8Array>({
      async start(c) {
        await new Promise((r) => setTimeout(r, wait));
        if (init?.signal?.aborted) return c.error(Object.assign(new Error('a'), { name: 'AbortError' }));
        c.enqueue(bytes.slice(0, Math.ceil(bytes.length / 2)));
        c.enqueue(bytes.slice(Math.ceil(bytes.length / 2)));
        c.close();
        active -= 1;
      },
    });
    init?.signal?.addEventListener('abort', () => (active = Math.max(0, active - 1)));
    return new Response(body, { status: 206, headers: { 'Content-Length': String(b - a + 1), 'Content-Type': 'video/mp4' } });
  }) as typeof fetch;
  return { impl, calls, maxActive: () => maxActive };
}

const read = async (res: Response) => new Uint8Array(await res.arrayBuffer());
const expectBytes = (got: Uint8Array, a: number) => {
  let bad = -1;
  for (let i = 0; i < got.length && bad < 0; i++) if (got[i] !== (a + i) % 251) bad = i;
  expect(bad).toBe(-1);
};

describe('range parsing and splitting', () => {
  it('PERF-010: parses closed and open ranges, rejects suffix, multi and garbage', () => {
    expect(parseRange('bytes=0-99')).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=500-')).toEqual({ start: 500, end: null });
    expect(parseRange('bytes=7-7')).toEqual({ start: 7, end: 7 });
    for (const bad of ['bytes=-500', 'bytes=0-1,5-9', 'bytes=9-3', 'items=0-1', '', null]) expect(parseRange(bad)).toBeNull();
    expect(parseContentRange('bytes 0-9/100')).toEqual({ start: 0, end: 9, total: 100 });
    expect(parseContentRange('bytes 0-9/*')?.total).toBeNull();
  });

  it('PERF-010: clamps to 8 MB, to the end of the file, and drops spans past EOF', () => {
    expect(clampSpan(0, null)).toEqual({ start: 0, end: PF.MAX_RESPONSE_BYTES - 1 });
    expect(clampSpan(100, 199)).toEqual({ start: 100, end: 199 });
    expect(clampSpan(0, null, 1000)).toEqual({ start: 0, end: 999 });
    expect(clampSpan(900, 5000, 1000)).toEqual({ start: 900, end: 999 });
    expect(clampSpan(1000, null, 1000)).toBeNull();
    expect(clampSpan(5, 5)).toEqual({ start: 5, end: 5 });
  });

  it('PERF-010: splits into 4 contiguous pieces whose sizes sum to the length', () => {
    for (const [a, b] of [[0, 8 * 1024 * 1024 - 1], [10, 10], [0, 2], [5, 1005], [123, 124]] as const) {
      const parts = splitSpan({ start: a, end: b });
      expect(parts.length).toBe(Math.min(4, b - a + 1));
      expect(parts[0]!.start).toBe(a);
      expect(parts.at(-1)!.end).toBe(b);
      parts.forEach((p, i) => {
        expect(p.end).toBeGreaterThanOrEqual(p.start);
        if (i) expect(p.start).toBe(parts[i - 1]!.end + 1);
      });
      expect(parts.reduce((n, p) => n + p.end - p.start + 1, 0)).toBe(b - a + 1);
    }
    const even = splitSpan({ start: 0, end: 399 });
    expect(even.map((p) => p.end - p.start + 1)).toEqual([100, 100, 100, 100]);
  });

  it('PERF-010: points the 302 host at a stable file host and leaves file hosts alone', () => {
    const a = fileHostUrl(ORIGINAL)!;
    expect(a).toMatch(/^https:\/\/cndw[1-6]\.cee\.buzz\/v\/a\.mp4\?Expires=4102444800&Signature=x$/);
    expect(fileHostUrl(ORIGINAL)).toBe(a);
    expect(fileHostUrl(ORIGINAL, 1)).not.toBe(a);
    const file = 'https://cndw4.cee.buzz/v/a.mp4?Expires=1';
    expect(fileHostUrl(file)).toBe(file);
    expect(fileHostUrl('https://cnth2.cee.buzz/x.jpg')).toBeNull();
    expect(fileHostUrl('http://cdn.cee.buzz/x.mp4')).toBeNull();
  });

  it('PERF-010: knows the mirror video hosts', () => {
    for (const h of ['cdn.cee.buzz', 'cndw1.cee.buzz', 'CNDW12.cee.buzz']) expect(isMirrorMediaHost(h)).toBe(true);
    for (const h of ['cee.buzz', 'cnth2.cee.buzz', 'cndw1.cee.buzz.evil.com', 'evilcee.buzz', 'cndw1.shabakaty.com']) expect(isMirrorMediaHost(h)).toBe(false);
  });
});

describe('ordered stream', () => {
  const ranges: ByteRange[] = [{ start: 0, end: 3 }, { start: 4, end: 7 }, { start: 8, end: 11 }];
  const bodyOf = (a: number, b: number, wait: number) =>
    new ReadableStream<Uint8Array>({
      async start(c) {
        await new Promise((r) => setTimeout(r, wait));
        c.enqueue(Uint8Array.from({ length: b - a + 1 }, (_, i) => a + i));
        c.close();
      },
    });

  it('PERF-010: out-of-order arrival still yields in-order bytes', async () => {
    const waits = [60, 30, 1];
    const stream = orderedPieceStream(ranges, async (r) => ({ body: bodyOf(r.start, r.end, waits[Math.floor(r.start / 4)]!) }), new AbortController().signal);
    const out = new Uint8Array(await new Response(stream).arrayBuffer());
    expect([...out]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('PERF-010: streams piece 1 before the later pieces have arrived', async () => {
    const stream = orderedPieceStream(ranges, async (r) => ({ body: bodyOf(r.start, r.end, r.start === 0 ? 1 : 300) }), new AbortController().signal);
    const t0 = Date.now();
    const first = await stream.getReader().read();
    expect(first.value?.length).toBe(4);
    expect(Date.now() - t0).toBeLessThan(200);
  });

  it('PERF-011: aborting errors the stream and aborts every piece', async () => {
    const seen: AbortSignal[] = [];
    const ctl = new AbortController();
    const stream = orderedPieceStream(ranges, async (_r, signal) => {
      seen.push(signal);
      return { body: new ReadableStream<Uint8Array>({ start(c) { signal.addEventListener('abort', () => c.error(Object.assign(new Error('a'), { name: 'AbortError' }))); } }) };
    }, ctl.signal);
    const reading = new Response(stream).arrayBuffer();
    await new Promise((r) => setTimeout(r, 10));
    ctl.abort();
    await expect(reading).rejects.toBeTruthy();
    expect(seen.length).toBe(3);
    expect(seen.every((s) => s.aborted)).toBe(true);
  });

  it('PERF-012: reopens a piece that drops mid-stream from the byte it reached', async () => {
    const opens: ByteRange[] = [];
    let first = true;
    const stream = orderedPieceStream([{ start: 0, end: 5 }], async (r) => {
      opens.push(r);
      if (first) {
        first = false;
        return { body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(Uint8Array.from([0, 1])); setTimeout(() => c.error(new TypeError('net')), 20); } }) };
      }
      return { body: bodyOf(r.start, r.end, 0) };
    }, new AbortController().signal);
    expect([...new Uint8Array(await new Response(stream).arrayBuffer())]).toEqual([0, 1, 2, 3, 4, 5]);
    expect(opens[1]).toEqual({ start: 2, end: 5 });
  });

  it('PERF-012: fails the stream when a piece keeps failing', async () => {
    const stream = orderedPieceStream([{ start: 0, end: 5 }], async () => { throw new TypeError('net'); }, new AbortController().signal);
    await expect(new Response(stream).arrayBuffer()).rejects.toThrow('net');
  });
});

describe('limiter', () => {
  it('PERF-011: never runs more than 8 at once, in order, and skips aborted waiters', async () => {
    const run = createLimiter(PF.MAX_CONNECTIONS);
    let active = 0;
    let peak = 0;
    const order: number[] = [];
    const ctl = new AbortController();
    const jobs = Array.from({ length: 14 }, (_, i) =>
      run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        order.push(i);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
      }, i === 10 ? ctl.signal : undefined).catch(() => 'aborted'),
    );
    ctl.abort();
    await Promise.all(jobs);
    expect(peak).toBe(PF.MAX_CONNECTIONS);
    expect(order).not.toContain(10);
    expect(order).toEqual(order.slice().sort((a, b) => a - b));
  });
});

describe('parallel fetcher', () => {
  const ask = (range: string, signal = new AbortController().signal) => ({ url: ORIGINAL, range, signal });

  it('PERF-010: answers an open-ended range with one 206 built from 4 pieces', async () => {
    const size = 20 * 1024 * 1024;
    const srv = fakeServer(size);
    const res = (await createParallelFetcher({ fetch: srv.impl }).respond(ask('bytes=0-')))!;
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 0-${PF.MAX_RESPONSE_BYTES - 1}/${size}`);
    expect(res.headers.get('content-length')).toBe(String(PF.MAX_RESPONSE_BYTES));
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(srv.calls.length).toBe(5); // a HEAD for the size, then the 4 pieces
    const body = await read(res);
    expect(body.length).toBe(PF.MAX_RESPONSE_BYTES);
    expectBytes(body, 0);
  });

  it('PERF-010: goes straight to a file host (the 302 host has no CORS) and keeps to one host per file', async () => {
    const srv = fakeServer(1_000_000);
    await read((await createParallelFetcher({ fetch: srv.impl }).respond(ask('bytes=0-')))!);
    const hosts = new Set(srv.calls.map((c) => new URL(c.url).hostname));
    expect(hosts.size).toBe(1);
    expect([...hosts][0]).toMatch(/^cndw[1-6]\.cee\.buzz$/);
    expect(srv.calls[0]!.range).toBe('');
    expect(srv.calls[0]!.url.split('?')[1]).toBe(ORIGINAL.split('?')[1]);
  });

  it('PERF-010: the last chunk past EOF ends at the last byte', async () => {
    const size = 1_000_003;
    const srv = fakeServer(size);
    const res = (await createParallelFetcher({ fetch: srv.impl }).respond(ask('bytes=900000-')))!;
    expect(res.headers.get('content-range')).toBe(`bytes 900000-${size - 1}/${size}`);
    const body = await read(res);
    expect(body.length).toBe(size - 900000);
    expectBytes(body, 900000);
  });

  it('PERF-010: a range that ends inside the first piece skips the other pieces', async () => {
    const srv = fakeServer(100);
    const res = (await createParallelFetcher({ fetch: srv.impl }).respond(ask('bytes=10-90')))!;
    expect(res.headers.get('content-range')).toBe('bytes 10-90/100');
    expect((await read(res)).length).toBe(81);
    const tail = (await createParallelFetcher({ fetch: srv.impl }).respond(ask('bytes=99-99')))!;
    expect(await read(tail)).toEqual(Uint8Array.from([99]));
  });

  it('PERF-010: pieces that start past the end (416) are empty', async () => {
    const size = 5000;
    const srv = fakeServer(size);
    const res = (await createParallelFetcher({ fetch: srv.impl }).respond(ask('bytes=4000-')))!;
    expect(res.headers.get('content-range')).toBe('bytes 4000-4999/5000');
    expect((await read(res)).length).toBe(1000);
  });

  it('PERF-010: delivers in order when later pieces arrive first', async () => {
    const srv = fakeServer(4000, { delay: (a) => (a === 0 ? 40 : 1) });
    const res = (await createParallelFetcher({ fetch: srv.impl }).respond(ask('bytes=0-3999')))!;
    expectBytes(await read(res), 0);
  });

  it('PERF-011: never more than 8 connections across concurrent responses', async () => {
    const srv = fakeServer(4_000_000, { delay: () => 15 });
    const f = createParallelFetcher({ fetch: srv.impl });
    const all = await Promise.all([ask('bytes=0-'), ask('bytes=1000000-'), ask('bytes=2000000-')].map((r) => f.respond(r)));
    await Promise.all(all.map((r) => read(r!)));
    expect(srv.maxActive()).toBeLessThanOrEqual(PF.MAX_CONNECTIONS);
  });

  it('PERF-011: aborting frees the connections and never stores bodies', async () => {
    const srv = fakeServer(4_000_000, { delay: () => 50 });
    const f = createParallelFetcher({ fetch: srv.impl });
    const ctl = new AbortController();
    const res = (await f.respond(ask('bytes=0-', ctl.signal)))!;
    const reading = read(res).catch(() => 'aborted');
    ctl.abort();
    expect(await reading).toBe('aborted');
    const next = (await f.respond(ask('bytes=0-1999')))!;
    expect((await read(next)).length).toBe(2000);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('PERF-012: retries a throttled first piece once, then succeeds', async () => {
    const srv = fakeServer(4000, { fail: (n) => (n === 2 ? 429 : null) });
    const res = await createParallelFetcher({ fetch: srv.impl }).respond(ask('bytes=0-3999'));
    expect(res?.status).toBe(206);
    expectBytes(await read(res!), 0);
  });

  it('PERF-012: falls back (null) when the first piece fails twice, on 429, 503 and network errors', async () => {
    for (const fail of [429, 503, 'net'] as const) {
      const srv = fakeServer(4000, { fail: (_n, r) => (r === 'HEAD' ? null : fail) });
      expect(await createParallelFetcher({ fetch: srv.impl }).respond(ask('bytes=0-3999'))).toBeNull();
      expect(srv.calls.length).toBe(3); // HEAD, piece 0, its one retry
      const noSize = fakeServer(4000, { fail: () => fail });
      expect(await createParallelFetcher({ fetch: noSize.impl }).respond(ask('bytes=0-3999'))).toBeNull();
    }
  });

  it('PERF-012: falls back when the server ignores the range or the range is not splittable', async () => {
    expect(await createParallelFetcher({ fetch: fakeServer(4000, { noRange: true }).impl }).respond(ask('bytes=0-3999'))).toBeNull();
    const f = createParallelFetcher({ fetch: fakeServer(4000).impl });
    expect(await f.respond(ask('bytes=-500'))).toBeNull();
    expect(await f.respond(ask('bytes=9000-'))).toBeNull();
  });

  it('PERF-012: a piece that fails once mid-way is retried and the bytes are still right', async () => {
    const srv = fakeServer(4000, { fail: (n) => (n === 4 ? 503 : null) });
    const res = (await createParallelFetcher({ fetch: srv.impl }).respond(ask('bytes=0-3999')))!;
    const body = await read(res);
    expect(body.length).toBe(4000);
    expectBytes(body, 0);
  });

  it('PERF-010: refetches from the original link once the signed one is expiring', async () => {
    const srv = fakeServer(4000);
    let now = 1_600_000_000_000;
    const f = createParallelFetcher({ fetch: srv.impl, now: () => now });
    await read((await f.respond(ask('bytes=0-3999')))!);
    f.files.set(ORIGINAL, { url: 'https://cndw3.cee.buzz/v/a.mp4?Expires=1700000000&Signature=x', total: 4000, type: 'video/mp4' });
    now = 1_699_999_800_000;
    srv.calls.length = 0;
    await read((await f.respond(ask('bytes=0-3999')))!);
    expect(srv.calls[0]!.range).toBe(''); // a new HEAD, on the original link's query
    expect(srv.calls[0]!.url).toContain('Expires=4102444800');
  });
});

describe('when it runs', () => {
  it('PERF-013: only for the mirror hosts, a splittable range, the "other" provider and no kill switch', () => {
    const base = { killed: false, providerOther: true, hostname: 'cndw2.cee.buzz', range: 'bytes=0-' };
    expect(shouldParallelize(base)).toBe(true);
    expect(shouldParallelize({ ...base, killed: true })).toBe(false);
    expect(shouldParallelize({ ...base, providerOther: false })).toBe(false);
    expect(shouldParallelize({ ...base, hostname: 'cnth2.shabakaty.com' })).toBe(false);
    expect(shouldParallelize({ ...base, range: null })).toBe(false);
  });

  it('PERF-013: the page wants it for Other unless wmp:pf is off; EL never', () => {
    expect(pfWanted('other', null)).toBe(true);
    expect(pfWanted('other', 'on')).toBe(true);
    expect(pfWanted('other', 'off')).toBe(false);
    expect(pfWanted('el', null)).toBe(false);
    expect(pfWanted('el', 'on')).toBe(false);
    expect(pfAllowed('off')).toBe(false);
  });
});
