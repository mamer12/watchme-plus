/** Where the sync backend is. Both values come from the build environment; without them Sync is hidden and never runs. */

export interface SyncConfig {
  /** Project URL, no trailing slash. */
  url: string;
  /** The public (anon) key. Public by design; the service-role key never belongs in this app. */
  anonKey: string;
}

export function readSyncConfig(env: Record<string, unknown> = import.meta.env as Record<string, unknown>): SyncConfig | null {
  const url = typeof env.VITE_SUPABASE_URL === 'string' ? env.VITE_SUPABASE_URL.trim().replace(/\/+$/, '') : '';
  const anonKey = typeof env.VITE_SUPABASE_ANON_KEY === 'string' ? env.VITE_SUPABASE_ANON_KEY.trim() : '';
  if (!/^https:\/\/[^/\s]+$/.test(url) || !anonKey) return null;
  return { url, anonKey };
}

export const syncEnabled = (env?: Record<string, unknown>): boolean => readSyncConfig(env) !== null;
