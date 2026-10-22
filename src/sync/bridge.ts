/** The small always-loaded door between the app (player, reset) and the lazily loaded sync engine. All no-ops until the engine runs. */
import { removeKey } from '../lib/storage';
import type { LibraryState } from '../state/library';
import { SYNC_KEY } from './syncStorage';
import { setSyncStatus } from './status';

export interface BridgeHandlers {
  /** Push now (pause, seek, end, leaving the player). `keepalive` survives the page closing. */
  flush(opts?: { keepalive?: boolean }): void;
  /** The video playing on this device right now (or null): remote rows for it are ignored meanwhile. */
  playing(videoId: string | null): void;
  stop(): void;
  /** Runs a library swap (another profile opens) without it counting as an edit, then pulls that profile's rows. */
  switchProfile(swap: () => void): void;
  /** A profile was deleted and its synced rows must be tombstoned: its library, still readable. */
  purge(profileId: string, lib: LibraryState): void;
}

let handlers: BridgeHandlers | null = null;

export function registerBridge(h: BridgeHandlers | null): void {
  handlers = h;
}

export const syncFlush = (opts?: { keepalive?: boolean }): void => handlers?.flush(opts);
/** Swaps the live library; the sync engine (if running) keeps the swap out of its change tracking. */
export const syncSwitchProfile = (swap: () => void): void => (handlers ? handlers.switchProfile(swap) : swap());
export const syncPurge = (profileId: string, lib: LibraryState): void => handlers?.purge(profileId, lib);
export const syncPlaying = (id: string | null): void => handlers?.playing(id);

/** Forget the sync session on this device (Reset this site). Server data is not touched. */
export function syncSignOutLocal(): void {
  try {
    handlers?.stop();
  } catch {
    /* signing out must never fail */
  }
  removeKey(SYNC_KEY);
  setSyncStatus({ linked: false, phase: 'off', lastSyncAt: null, pending: 0, email: null, gettingProfiles: false, toast: null });
}
