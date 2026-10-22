/** A tiny external store for the library of the active profile, persisted to localStorage.
 * Each profile has its own saved library; the device's own settings (quality, volume...) are shared by all of them. */
import { useSyncExternalStore } from 'react';
import { DEVICE_SETTING_KEYS, pickDevice, type DeviceSettings, type LibraryState } from './library';
import { readJson, writeJson } from '../lib/storage';
import { enforceKids } from '../profiles/kids';
import { bootProfile, DEVICE_KEY, libraryKey, loadLibraryFor } from '../profiles/persist';

const SAVE_DELAY_MS = 250;

const boot = bootProfile();
let activeId = boot.id;
let kids = boot.kids;
const loaded = loadLibraryFor(activeId, kids);
let state: LibraryState = loaded.state;
let device: DeviceSettings = loaded.device;
// First run of profiles: the device's own settings come from the library that was already here; keep them from now on.
if (readJson(DEVICE_KEY) === null) writeJson(DEVICE_KEY, device);
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function save(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  writeJson(libraryKey(activeId), state, 'wmp:api:');
}

const deviceChanged = (s: LibraryState): boolean => DEVICE_SETTING_KEYS.some((k) => s.settings[k] !== device[k]);

export function getState(): LibraryState {
  return state;
}

export function update(fn: (s: LibraryState) => LibraryState): void {
  let next = fn(state);
  if (kids) next = enforceKids(next);
  if (next === state) return;
  state = next;
  if (deviceChanged(next)) {
    device = pickDevice(next.settings);
    writeJson(DEVICE_KEY, device);
  }
  listeners.forEach((l) => l());
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(save, SAVE_DELAY_MS);
}

/** Saves right away (on pagehide and when leaving the player). */
export function flush(): void {
  if (saveTimer) save();
}

/** Forgets an unsaved change (the library is about to be wiped: a late save must not bring it back). */
export function discardPendingSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
}

export const activeProfileId = (): string => activeId;

/** Makes another profile's library the live one: saves the current one first, then every listener sees the new state. */
export function switchLibrary(id: string, isKids: boolean): void {
  flush();
  writeJson(DEVICE_KEY, device);
  activeId = id;
  kids = isKids;
  const next = loadLibraryFor(id, isKids);
  state = next.state;
  device = next.device;
  listeners.forEach((l) => l());
}

/** Another profile's saved library, read without switching to it. */
export const readLibrary = (id: string): LibraryState => loadLibraryFor(id, false).state;

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Selectors must return a stable value (a slice of state or a primitive). */
export function useLibrary<T>(selector: (s: LibraryState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(state));
}

export const useSettings = () => useLibrary((s) => s.settings);

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  // Another tab changed this profile's library or the device settings.
  window.addEventListener('storage', (e) => {
    if (!e.newValue || (e.key !== libraryKey(activeId) && e.key !== DEVICE_KEY)) return;
    try {
      if (e.key === DEVICE_KEY) {
        // Only the device settings moved: keep this tab's unsaved library changes.
        device = { ...device, ...(readJson<Partial<DeviceSettings>>(DEVICE_KEY) ?? {}) };
        state = { ...state, settings: { ...state.settings, ...device } };
      } else {
        const next = loadLibraryFor(activeId, kids);
        state = next.state;
        device = next.device;
      }
      listeners.forEach((l) => l());
    } catch {
      /* ignore a malformed write from another tab */
    }
  });
}
