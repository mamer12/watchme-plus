import { useEffect, useRef, useState } from 'react';
import { deviceNameFromUA, formatCode, joinErrorMessage, parseJoinParam } from './codes';
import { syncEnabled } from './config';
import { capabilities } from '../profiles/logic';
import { profileStore, useProfiles } from '../profiles/singleton';
import { loadSyncService } from './runtime';

/** `?join=CODE` in the address: ask first, then join. */
export function JoinPrompt() {
  const [code, setCode] = useState<string | null>(() => (syncEnabled() && typeof window !== 'undefined' ? parseJoinParam(window.location.search) : null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!code) return;
    cancel.current?.focus();
  }, [code]);

  const close = () => {
    setCode(null);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('join');
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    } catch {
      /* the address stays as it is */
    }
  };

  useProfiles();
  if (!code || !capabilities(profileStore.active()).sync) return null;

  async function join() {
    if (!code) return;
    setBusy(true);
    setError(null);
    try {
      const s = await loadSyncService();
      const res = await s.join(code, deviceNameFromUA(navigator.userAgent, { touchPoints: navigator.maxTouchPoints }));
      if (res.ok) close();
      else setError(joinErrorMessage(res.error));
    } catch {
      setError(joinErrorMessage('error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" data-nav-scope>
      <div className="modal reset-dialog" role="alertdialog" aria-modal="true" aria-labelledby="join-title" aria-describedby="join-desc">
        <h2 id="join-title">Join sync?</h2>
        <div id="join-desc">
          <p>Code {formatCode(code)}. This device will share progress, My List, ratings and viewing preferences with your other devices.</p>
          <p>What is already saved here is kept and added to the shared library.</p>
        </div>
        {error && <p role="alert" className="reset-dialog__error">{error}</p>}
        <div className="reset-dialog__actions">
          <button ref={cancel} type="button" className="btn btn--info btn--sm" onClick={close}>
            Cancel
          </button>
          <button type="button" className="btn btn--play btn--sm" disabled={busy} onClick={() => void join()}>
            {busy ? 'Joining…' : 'Join'}
          </button>
        </div>
      </div>
    </div>
  );
}
