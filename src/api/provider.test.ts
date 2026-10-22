import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DETECT, detectProvider, realClock, probeProvider } from './detect';
import { ISP_CHECKED_KEY, ISP_KEY, PROVIDERS, apiBase, getIsp, probeUrl, providerById, resetIspForTests, usableId, usableProviders, type Isp, type Provider } from './endpoints';
import { reportCatalogFailure, reportCatalogOk } from './health';
import { createProviderManager } from './provider';
import { memoryStore } from '../lib/storage';

type Behaviour = { after: number; body?: string; status?: number; fail?: boolean };

/** A fetch fake: each host answers after `after` ms with a body, an HTTP status or a network error; honours abort. */
function fakeFetch(hosts: Record<string, Behaviour>) {
  const calls: string[] = [];
  const impl = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const b = hosts[new URL(url).host];
    return new Promise<Response>((resolve, reject) => {
      if (!b) return reject(new TypeError('no route'));
      const t = setTimeout(() => (b.fail ? reject(new TypeError('Failed to fetch')) : resolve(new Response(b.body ?? '[{"id":1}]', { status: b.status ?? 200 }))), b.after);
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new DOMException('aborted', 'AbortError'));
      });
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const EL = providerById('el')!.host!;
const MIRROR = providerById('other')!.host!;
const deps = (f: typeof fetch, providers?: readonly Provider[]) => ({ fetch: f, clock: realClock, providers });

async function detectAt(hosts: Record<string, Behaviour>, ms: number, providers?: readonly Provider[]) {
  const f = fakeFetch(hosts);
  const p = detectProvider(deps(f.impl, providers));
  await vi.advanceTimersByTimeAsync(ms);
  return { p, calls: f.calls };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetIspForTests();
  reportCatalogOk();
});

describe('provider registry', () => {
  it('PROV-001: providers are ordered EL, Albox, mirror; the mirror keeps the id "other"', () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(['el', 'albox', 'other']);
    const other = providerById('other')!;
    expect(other.host).toBe('cee.buzz');
    expect(other.parallelFetch).toBe(true);
    expect(other.defaultQuality).toBe('480p');
  });

  it('PROV-001: Albox stays disabled until it has a hostname, is never probed and never stored', async () => {
    const albox = providerById('albox')!;
    expect(albox.host).toBeNull();
    expect(albox.enabled).toBe(false);
    expect(usableProviders().map((p) => p.id)).toEqual(['el', 'other']);
    expect(usableId('albox')).toBeNull();
    const { p, calls } = await detectAt({ [EL]: { after: 10 }, [MIRROR]: { after: 10 } }, 100);
    await p;
    expect(calls.every((u) => !u.includes('null'))).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('PROV-001: an enabled Albox with a host is probed and outranks the mirror', async () => {
    const albox: Provider = { ...providerById('albox')!, host: 'albox.test', imageHosts: ['img.albox.test'], enabled: true };
    const list = [providerById('el')!, albox, providerById('other')!];
    const { p, calls } = await detectAt({ [EL]: { after: 9000 }, 'albox.test': { after: 50 }, [MIRROR]: { after: 10 } }, 1700, list);
    expect((await p).id).toBe('albox');
    expect(calls.some((u) => u.startsWith('https://albox.test/api/android/'))).toBe(true);
  });
});

describe('provider detection', () => {
  it('PROV-002: probes the cheap categories request with a 3.5 s timeout', async () => {
    const f = fakeFetch({ [EL]: { after: 10_000 } });
    const seen: RequestInit[] = [];
    const spy = ((u: RequestInfo | URL, i?: RequestInit) => (seen.push(i!), f.impl(u, i))) as typeof fetch;
    const p = probeProvider(providerById('el')!, deps(spy));
    await vi.advanceTimersByTimeAsync(3499);
    let settled = false;
    void p.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await p).toBe(false);
    expect(f.calls[0]).toBe(`https://${EL}/api/android/mainCategories?lang=en`);
    expect(probeUrl(providerById('other')!)).toBe('https://cee.buzz/api/android/mainCategories?lang=en');
    expect(seen[0]).toMatchObject({ mode: 'cors', cache: 'no-store' });
  });

  it('PROV-002: invalid JSON, a non-array body and an HTTP error all count as a failure', async () => {
    for (const b of [{ after: 5, body: '<html>blocked</html>' }, { after: 5, body: '{"a":1}' }, { after: 5, status: 500 }, { after: 5, fail: true }]) {
      const f = fakeFetch({ [EL]: b });
      const p = probeProvider(providerById('el')!, deps(f.impl));
      await vi.advanceTimersByTimeAsync(10);
      expect(await p).toBe(false);
    }
  });

  it('PROV-003: when EL answers, EL is used', async () => {
    const { p } = await detectAt({ [EL]: { after: 100 }, [MIRROR]: { after: 50 } }, 200);
    expect((await p).id).toBe('el');
  });

  it('PROV-003: the first success does not hurry the pick: EL answering within the 1.5 s grace still wins', async () => {
    const { p } = await detectAt({ [EL]: { after: 1200 }, [MIRROR]: { after: 100 } }, 1700);
    expect((await p).id).toBe('el');
  });

  it('PROV-003: EL timing out while the mirror answers picks the mirror after the grace', async () => {
    const f = fakeFetch({ [EL]: { after: 20_000 }, [MIRROR]: { after: 100 } });
    const p = detectProvider(deps(f.impl));
    let id: Isp | null | undefined;
    void p.then((r) => (id = r.id));
    await vi.advanceTimersByTimeAsync(1500);
    expect(id).toBeUndefined();
    await vi.advanceTimersByTimeAsync(200);
    expect(id).toBe('other');
  });

  it('PROV-003: EL failing fast hands the pick to the mirror at once', async () => {
    const { p } = await detectAt({ [EL]: { after: 20, fail: true }, [MIRROR]: { after: 100 } }, 150);
    expect((await p).id).toBe('other');
  });
});

describe('provider manager', () => {
  function setup(hosts: Record<string, Behaviour>, opts: { stored?: string; checkedAgoMs?: number; search?: string } = {}) {
    const kv = memoryStore();
    if (opts.stored) kv.setItem(ISP_KEY, opts.stored);
    if (opts.checkedAgoMs !== undefined) kv.setItem(ISP_CHECKED_KEY, String(Date.now() - opts.checkedAgoMs));
    const f = fakeFetch(hosts);
    const applied: { id: Isp; persist: boolean }[] = [];
    let active: Isp = (opts.stored as Isp | undefined) ?? 'el';
    const m = createProviderManager({
      fetch: f.impl,
      clock: realClock,
      storage: kv,
      apply: (id, persist) => {
        applied.push({ id, persist });
        active = id;
        if (persist) kv.setItem(ISP_KEY, id);
      },
      getActive: () => active,
      search: opts.search ?? '',
    });
    return { m, kv, f, applied, active: () => active };
  }
  const ok = (after = 50): Behaviour => ({ after });
  const down: Behaviour = { after: 20, fail: true };
  const HOUR = 3_600_000;

  afterEach(() => reportCatalogOk());

  it('PROV-004: with nothing answering, the last known provider is kept and detection retries after 2 s, 6 s and 15 s', async () => {
    const s = setup({ [EL]: down, [MIRROR]: down }, { stored: 'other', checkedAgoMs: HOUR });
    void s.m.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(s.f.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(s.f.calls).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(5900);
    expect(s.f.calls).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(200);
    expect(s.f.calls).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(15_100);
    expect(s.f.calls).toHaveLength(8);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.f.calls).toHaveLength(8);
    expect(s.applied).toEqual([]);
    expect(DETECT.RETRY_MS).toEqual([2000, 6000, 15000]);
    s.m.stop();
  });

  it('PROV-004: on a first run where nothing answers the fallback is the mirror (not stored), and the browser coming online retries', async () => {
    const s = setup({ [EL]: down, [MIRROR]: down });
    const listeners: (() => void)[] = [];
    const m = createProviderManager({ fetch: s.f.impl, clock: realClock, storage: s.kv, apply: (id, persist) => void s.applied.push({ id, persist }), getActive: () => 'el', search: '', events: { addEventListener: (_t, l) => void listeners.push(l) } });
    void m.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(s.applied).toEqual([{ id: 'other', persist: false }]);
    expect(s.kv.getItem(ISP_KEY)).toBeNull();
    await vi.advanceTimersByTimeAsync(30_000);
    const before = s.f.calls.length;
    listeners[0]!();
    await vi.advanceTimersByTimeAsync(100);
    expect(s.f.calls.length).toBe(before + 2);
    m.stop();
  });

  it('PROV-005: a cached provider starts at once, with no splash, and detection still runs on every cold start', async () => {
    const s = setup({ [EL]: ok(), [MIRROR]: ok() }, { stored: 'el', checkedAgoMs: HOUR });
    void s.m.start();
    expect(s.m.getState().phase).toBe('ready');
    await vi.advanceTimersByTimeAsync(100);
    expect(s.f.calls).toHaveLength(2);
    expect(s.applied).toEqual([{ id: 'el', persist: true }]);
    s.m.stop();
  });

  it('PROV-005: the cached provider failing while another passes switches to it', async () => {
    const s = setup({ [EL]: down, [MIRROR]: ok() }, { stored: 'el', checkedAgoMs: HOUR });
    void s.m.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(s.active()).toBe('other');
    s.m.stop();
  });

  it('PROV-005: a higher-priority provider passing while the mirror is active switches up', async () => {
    const s = setup({ [EL]: ok(), [MIRROR]: ok() }, { stored: 'other', checkedAgoMs: HOUR });
    void s.m.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(s.active()).toBe('el');
    s.m.stop();
  });

  it('PROV-005: the splash shows only with no cached provider or one older than 24 h', async () => {
    const none = setup({ [EL]: ok(), [MIRROR]: ok() });
    void none.m.start();
    expect(none.m.getState().phase).toBe('detecting');
    await vi.advanceTimersByTimeAsync(100);
    expect(none.m.getState().phase).toBe('ready');
    expect(Number(none.kv.getItem(ISP_CHECKED_KEY))).toBeGreaterThan(1_800_000_000_000);
    expect(none.kv.getItem(ISP_KEY)).toBe('el');
    none.m.stop();
    const old = setup({ [EL]: ok(), [MIRROR]: ok() }, { stored: 'other', checkedAgoMs: DETECT.TRUST_MS + 1000 });
    void old.m.start();
    expect(old.m.getState().phase).toBe('detecting');
    await vi.advanceTimersByTimeAsync(100);
    expect(old.m.getState().phase).toBe('ready');
    old.m.stop();
    const fresh = setup({ [EL]: ok(), [MIRROR]: ok() }, { stored: 'other', checkedAgoMs: DETECT.TRUST_MS - 60_000 });
    void fresh.m.start();
    expect(fresh.m.getState().phase).toBe('ready');
    await vi.advanceTimersByTimeAsync(100);
    fresh.m.stop();
  });

  it('PROV-005: the first-run splash never lasts longer than 4 s', async () => {
    const s = setup({ [EL]: { after: 60_000 }, [MIRROR]: { after: 60_000 } });
    void s.m.start();
    await vi.advanceTimersByTimeAsync(3400);
    expect(s.m.getState().phase).toBe('detecting');
    await vi.advanceTimersByTimeAsync(700);
    expect(s.m.getState().phase).toBe('ready');
    expect(s.applied).toEqual([{ id: 'other', persist: false }]);
    s.m.stop();
  });

  it('PROV-005: coming back to a tab hidden for over 30 min runs detection again', async () => {
    const kv = memoryStore();
    kv.setItem(ISP_KEY, 'el');
    kv.setItem(ISP_CHECKED_KEY, String(Date.now()));
    const f = fakeFetch({ [EL]: ok(), [MIRROR]: ok() });
    const listeners: (() => void)[] = [];
    const doc = { hidden: false, addEventListener: (_t: string, l: () => void) => void listeners.push(l) };
    const m = createProviderManager({ fetch: f.impl, clock: realClock, storage: kv, apply: () => {}, getActive: () => 'el', search: '', doc });
    void m.start();
    await vi.advanceTimersByTimeAsync(100);
    const base = f.calls.length;
    doc.hidden = true;
    listeners[0]!();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    doc.hidden = false;
    listeners[0]!();
    await vi.advanceTimersByTimeAsync(100);
    expect(f.calls.length).toBe(base);
    doc.hidden = true;
    listeners[0]!();
    await vi.advanceTimersByTimeAsync(31 * 60_000);
    doc.hidden = false;
    listeners[0]!();
    await vi.advanceTimersByTimeAsync(100);
    expect(f.calls.length).toBe(base + 2);
    m.stop();
  });

  it('PROV-006: one failure does nothing; the second triggers detection; a success resets the count', async () => {
    const hosts: Record<string, Behaviour> = { [EL]: ok(), [MIRROR]: ok() };
    const s = setup(hosts, { stored: 'other', checkedAgoMs: HOUR });
    void s.m.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(s.active()).toBe('el');
    s.m.stop();

    // Fresh manager on the mirror whose catalog starts failing; EL is down so detection stays on the mirror.
    const t = setup({ [EL]: down, [MIRROR]: ok() }, { stored: 'other', checkedAgoMs: HOUR });
    void t.m.start();
    await vi.advanceTimersByTimeAsync(100);
    const base = t.f.calls.length;
    reportCatalogFailure();
    await vi.advanceTimersByTimeAsync(100);
    expect(t.f.calls.length).toBe(base);
    reportCatalogOk();
    reportCatalogFailure();
    await vi.advanceTimersByTimeAsync(100);
    expect(t.f.calls.length).toBe(base);
    reportCatalogFailure();
    await vi.advanceTimersByTimeAsync(100);
    expect(t.f.calls.length).toBe(base + 2);
    t.m.stop();
  });

  it('PROV-006: automatic switches are rate-limited to one per 60 s', async () => {
    const hosts: Record<string, Behaviour> = { [EL]: down, [MIRROR]: ok() };
    const s = setup(hosts, { stored: 'el', checkedAgoMs: HOUR });
    void s.m.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(s.active()).toBe('other');
    // EL recovers right away: a failure-triggered detection would switch back, but it is too soon.
    hosts[EL] = ok();
    reportCatalogFailure();
    reportCatalogFailure();
    await vi.advanceTimersByTimeAsync(2000);
    expect(s.active()).toBe('other');
    expect(s.applied.filter((a) => a.id === 'el')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(60_000);
    reportCatalogFailure();
    reportCatalogFailure();
    await vi.advanceTimersByTimeAsync(2000);
    expect(s.active()).toBe('el');
    s.m.stop();
  });

  it('PROV-006: Re-check runs detection now and is not rate-limited', async () => {
    const hosts: Record<string, Behaviour> = { [EL]: down, [MIRROR]: ok() };
    const s = setup(hosts, { stored: 'el', checkedAgoMs: HOUR });
    void s.m.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(s.active()).toBe('other');
    hosts[EL] = ok();
    const done = s.m.recheck();
    await vi.advanceTimersByTimeAsync(100);
    await done;
    expect(s.active()).toBe('el');
    s.m.stop();
  });

  it('PROV-007: ?isp= stores the choice, skips detection and fixes it for the session', async () => {
    const s = setup({ [EL]: ok(), [MIRROR]: ok() }, { stored: 'el', checkedAgoMs: 0, search: '?isp=other' });
    await s.m.start();
    expect(s.applied).toEqual([{ id: 'other', persist: true }]);
    expect(s.m.getState().fixed).toBe(true);
    expect(s.f.calls).toHaveLength(0);
    reportCatalogFailure();
    reportCatalogFailure();
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.f.calls).toHaveLength(0);
    expect(s.kv.getItem(ISP_CHECKED_KEY)).toBeNull();
  });

  it('PROV-007: an unknown or disabled ?isp= value is ignored', async () => {
    for (const search of ['?isp=nonsense', '?isp=albox']) {
      const s = setup({ [EL]: ok(), [MIRROR]: ok() }, { stored: 'el', checkedAgoMs: HOUR, search });
      void s.m.start();
      await vi.advanceTimersByTimeAsync(100);
      expect(s.m.getState().fixed).toBe(false);
      expect(s.f.calls).toHaveLength(2);
      s.m.stop();
    }
  });

  it('PROV-008: a stored id that is unknown or disabled falls back to detection', async () => {
    const kv = memoryStore();
    vi.stubGlobal('localStorage', kv);
    for (const bad of ['nonsense', 'albox', '']) {
      kv.setItem(ISP_KEY, bad);
      resetIspForTests();
      expect(getIsp()).toBe('el');
      expect(apiBase()).toBe(`https://${EL}/api/android/`);
    }
    const s = setup({ [EL]: down, [MIRROR]: ok() }, { stored: 'albox', checkedAgoMs: HOUR });
    void s.m.start();
    expect(s.m.getState().phase).toBe('detecting');
    await vi.advanceTimersByTimeAsync(1700);
    expect(s.applied.at(-1)).toEqual({ id: 'other', persist: true });
    s.m.stop();
  });

  it('PROV-009: every provider-dependent rule reads the registry', async () => {
    const { isAdaptive } = await import('../lib/adaptiveQuality');
    const { pfWanted } = await import('../lib/pfState');
    const { rehostImage, imageBase, hostsFor } = await import('./endpoints');
    expect(isAdaptive('other')).toBe(true);
    expect(isAdaptive('el')).toBe(false);
    expect(pfWanted('other', null)).toBe(true);
    expect(pfWanted('el', null)).toBe(false);
    expect(rehostImage('https://cnth2.shabakaty.cc/p/a.jpg', 'other')).toBe(`${imageBase('other')}p/a.jpg`);
    expect(hostsFor('albox')).toEqual([]);
  });
});
