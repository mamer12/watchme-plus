import { useEffect, useRef, useState } from 'react';
import { syncEnabled } from '../../sync/config';
import { browserResetEnv, resetSite, type ResetResult } from '../../lib/resetSite';

const STEP_LABELS: Record<string, string> = {
  sync: 'sync sign-in',
  localStorage: 'saved settings and library',
  sessionStorage: 'session data',
  indexedDB: 'offline databases',
  caches: 'cached images and data',
  cookies: 'cookies',
  serviceWorker: 'background service',
};

export function ResetSiteDialog({ onClose }: { onClose: () => void }) {
  const cancelBtn = useRef<HTMLButtonElement>(null);
  const [phase, setPhase] = useState<'confirm' | 'running' | 'done'>('confirm');
  const [result, setResult] = useState<ResetResult | null>(null);

  useEffect(() => {
    cancelBtn.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase === 'confirm' && (e.key === 'Escape' || e.key === 'Backspace')) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, onClose]);

  async function reset() {
    setPhase('running');
    // The page reloads itself after a short pause so the result can be read.
    let finish: () => void = () => {};
    const reloaded = new Promise<void>((r) => (finish = r));
    const res = await resetSite(browserResetEnv(() => finish()));
    setResult(res);
    setPhase('done');
    await reloaded;
    window.setTimeout(() => window.location.replace('/'), res.failed.length ? 4000 : 1200);
  }

  return (
    <div className="modal-backdrop" data-nav-scope onMouseDown={(e) => e.target === e.currentTarget && phase === 'confirm' && onClose()}>
      <div className="modal reset-dialog" role="alertdialog" aria-modal="true" aria-labelledby="reset-title" aria-describedby="reset-desc">
        <h2 id="reset-title">Reset this site?</h2>
        {phase === 'confirm' && (
          <>
            <div id="reset-desc">
              <p>This deletes everything Watchme+ stored in this browser and cannot be undone:</p>
              <ul>
                <li>Profiles, My List and ratings (profiles saved on the sync service stay there)</li>
                <li>Watch progress and Continue Watching</li>
                <li>Your settings and taste choices</li>
                <li>Downloaded and cached images and data</li>
              </ul>
              {syncEnabled() && (
                <p>
                  If Sync is on, this device also signs out of it. Your synced data stays on the sync service and your other devices
                  are not affected; to remove it, use Delete all synced data in Settings first.
                </p>
              )}
              <p>The app then restarts as if you opened it for the first time.</p>
              <p>Tip: opening the site with <code>?reset=1</code> at the end of the address does this without asking.</p>
            </div>
            <div className="reset-dialog__actions">
              <button ref={cancelBtn} type="button" className="btn btn--info btn--sm" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="btn btn--danger btn--sm" onClick={reset}>
                Delete everything
              </button>
            </div>
          </>
        )}
        {phase === 'running' && (
          <p id="reset-desc" role="status">
            Deleting…
          </p>
        )}
        {phase === 'done' && result && (
          <div id="reset-desc" role="status">
            <p>Done. Restarting…</p>
            {result.failed.length > 0 && (
              <p className="reset-dialog__error">
                Could not clear: {result.failed.map((f) => STEP_LABELS[f.step] ?? f.step).join(', ')}.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
