/** The eager entry to sync: cheap checks here, the engine loaded on demand. */
import { syncEnabled } from './config';
import { setSyncStatus } from './status';
import { isLinked, loadSync } from './syncStorage';

export const loadSyncService = () => import('./service').then((m) => m.getSyncService());

/** Called once at app start. Does nothing unless sync is configured and this browser is linked. */
export function startSync(): void {
  if (!syncEnabled() || !isLinked()) return;
  const st = loadSync();
  setSyncStatus({ linked: true, phase: 'syncing', deviceName: st.deviceName, email: st.email ?? null });
  void loadSyncService()
    .then((s) => s.resume())
    .catch(() => setSyncStatus({ phase: 'error' }));
}
