import { describe, expect, it } from 'vitest';
import { RELOAD_GUARD_MS, RELOAD_KEY, isResetRequested, reloadOnUpdate, shouldReloadForUpdate } from './appUpdate';

describe('reset by address', () => {
  it('PWA-006: detects ?reset=1, ?reset, ?reset=true and #reset, and nothing else', () => {
    expect(isResetRequested('?reset=1')).toBe(true);
    expect(isResetRequested('?a=b&reset=1')).toBe(true);
    expect(isResetRequested('?reset')).toBe(true);
    expect(isResetRequested('?reset=true')).toBe(true);
    expect(isResetRequested('', '#reset')).toBe(true);
    expect(isResetRequested('', '#reset=1')).toBe(true);
    expect(isResetRequested('?reset=0')).toBe(false);
    expect(isResetRequested('?resetx=1')).toBe(false);
    expect(isResetRequested('', '#resetting')).toBe(false);
    expect(isResetRequested('')).toBe(false);
  });
});

describe('update reload', () => {
  it('PWA-005: reloads only for an update of a controlled page, never in a loop', () => {
    expect(shouldReloadForUpdate({ hadController: false, lastReloadAt: null, now: 1000 })).toBe(false);
    expect(shouldReloadForUpdate({ hadController: true, lastReloadAt: null, now: 1000 })).toBe(true);
    expect(shouldReloadForUpdate({ hadController: true, lastReloadAt: 1000, now: 1000 + RELOAD_GUARD_MS - 1 })).toBe(false);
    expect(shouldReloadForUpdate({ hadController: true, lastReloadAt: 1000, now: 1000 + RELOAD_GUARD_MS })).toBe(true);
  });

  it('PWA-005: wires controllerchange once per window through the storage guard', () => {
    const kv = new Map<string, string>();
    const store = { getItem: (k: string) => kv.get(k) ?? null, setItem: (k: string, v: string) => void kv.set(k, v) };
    let fire: () => void = () => {};
    const sw = { controller: {}, addEventListener: (_t: 'controllerchange', fn: () => void) => void (fire = fn) };
    let reloads = 0;
    let t = 5000;
    reloadOnUpdate(sw, store, () => reloads++, () => t);
    fire();
    fire();
    expect(reloads).toBe(1);
    expect(kv.get(RELOAD_KEY)).toBe('5000');
    t += RELOAD_GUARD_MS;
    fire();
    expect(reloads).toBe(2);
    // First install: no earlier controller, no reload.
    let first: () => void = () => {};
    reloadOnUpdate({ controller: null, addEventListener: (_t, fn) => void (first = fn) }, store, () => reloads++, () => 9e9);
    first();
    expect(reloads).toBe(2);
  });
});
