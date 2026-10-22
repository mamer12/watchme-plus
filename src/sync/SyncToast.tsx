import { useEffect } from 'react';
import { setSyncStatus, useSyncStatus } from './status';

const SHOW_MS = 5000;

/** One-time message after the first sync ("Synced 12 items from TV"). */
export function SyncToast() {
  const { toast } = useSyncStatus();
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setSyncStatus({ toast: null }), SHOW_MS);
    return () => clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className="sync-toast" role="status">
      {toast}
    </div>
  );
}
