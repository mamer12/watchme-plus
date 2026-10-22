/** What the UI shows about sync. A tiny external store; the engine writes it, Settings and the toast read it. */
import { useSyncExternalStore } from 'react';

export type SyncPhase = 'off' | 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  linked: boolean;
  phase: SyncPhase;
  /** ms of the last successful round trip */
  lastSyncAt: number | null;
  /** Items waiting to be sent. */
  pending: number;
  deviceName: string;
  /** The signed-in account's email; null for a guest. */
  email: string | null;
  /** First sync after signing in: "Getting your profiles…". */
  gettingProfiles: boolean;
  /** A one-time message ("Synced 12 items from TV"). */
  toast: string | null;
}

let status: SyncStatus = { linked: false, phase: 'off', lastSyncAt: null, pending: 0, deviceName: '', email: null, gettingProfiles: false, toast: null };
const listeners = new Set<() => void>();

export const getSyncStatus = (): SyncStatus => status;

export function setSyncStatus(patch: Partial<SyncStatus>): void {
  const next = { ...status, ...patch };
  if ((Object.keys(next) as (keyof SyncStatus)[]).every((k) => next[k] === status[k])) return;
  status = next;
  listeners.forEach((l) => l());
}

export function subscribeSyncStatus(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const useSyncStatus = (): SyncStatus => useSyncExternalStore(subscribeSyncStatus, getSyncStatus, getSyncStatus);

/** "Synced just now", "Offline, will sync later", "Error, retrying". */
export function statusText(s: Pick<SyncStatus, 'phase' | 'lastSyncAt'>, now: number): string {
  if (s.phase === 'offline') return 'Offline, will sync later';
  if (s.phase === 'error') return 'Error, retrying';
  if (s.phase === 'syncing' && s.lastSyncAt === null) return 'Syncing…';
  if (s.lastSyncAt === null) return 'Waiting to sync';
  const sec = Math.max(0, Math.round((now - s.lastSyncAt) / 1000));
  if (sec < 60) return s.phase === 'syncing' ? 'Syncing…' : 'Synced just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `Synced ${min} min ago`;
  return `Synced ${Math.round(min / 60)} h ago`;
}
