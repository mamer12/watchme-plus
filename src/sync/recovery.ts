/** The "reset your password" link (`#access_token=…&type=recovery`): read once at start, kept only in memory, and scrubbed from the address. */
import { useSyncExternalStore } from 'react';
import { parseRecoveryHash, recoveryEnabled, type RecoverySession } from './accounts';
import { syncEnabled } from './config';

let pending: RecoverySession | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Called once at app start. Does nothing unless sync is on and recovery is enabled for this build. */
export function captureRecovery(hash: string, now: number = Date.now()): void {
  if (!syncEnabled() || !recoveryEnabled()) return;
  const r = parseRecoveryHash(hash, now);
  if (!r) return;
  pending = r;
  try {
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  } catch {
    /* the address keeps its hash: harmless, the tokens are single use */
  }
  emit();
}

export const getRecovery = (): RecoverySession | null => pending;
export function clearRecovery(): void {
  pending = null;
  emit();
}
export const useRecovery = (): RecoverySession | null =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getRecovery,
    getRecovery,
  );
