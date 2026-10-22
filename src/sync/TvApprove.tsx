/** Sign in a TV with this device: the "Sign in your TV?" dialog (from the QR code or a typed code) and the Settings row. */
import { useEffect, useRef, useState } from 'react';
import { CODE_LENGTH, isCompleteCode, normalizeCode } from './codes';
import { syncEnabled } from './config';
import { capabilities } from '../profiles/logic';
import { profileStore, useProfiles } from '../profiles/singleton';
import { loadSyncService } from './runtime';
import { useSyncStatus } from './status';
import { APPROVED_MESSAGE, KIDS_MESSAGE, approveErrorMessage, captureTvCode, clearPendingTv, groupTvCode, sessionStore, type ApproveResult } from './tvLogin';

const captureNow = (): string | null =>
  typeof window === 'undefined' || !syncEnabled()
    ? null
    : captureTvCode(window.location, sessionStore(), (u) => window.history.replaceState(window.history.state, '', u));

/** Called once when the app starts, before anything renders. */
export const useCapturedTvCode = (): string | null => useState(captureNow)[0];

function Dialog({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop" data-nav-scope>
      <div className="modal reset-dialog" role="alertdialog" aria-modal="true" aria-labelledby="tv-title">
        <h2 id="tv-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function TvApproveDialog({ code, onClose }: { code: string; onClose: () => void }) {
  const status = useSyncStatus();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApproveResult | null>(null);
  const first = useRef<HTMLButtonElement>(null);
  const done = result?.ok === true;
  useEffect(() => first.current?.focus(), [done]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const approve = async () => {
    setBusy(true);
    setResult(null);
    try {
      setResult(await (await loadSyncService()).approveDeviceLogin(code));
    } catch {
      setResult({ ok: false, error: 'error' });
    } finally {
      setBusy(false);
    }
  };
  // The code is only kept until it works or the person walks away.
  useEffect(() => {
    if (done) clearPendingTv(sessionStore());
  }, [done]);

  if (done) {
    return (
      <Dialog title="TV signed in">
        <p role="status">{APPROVED_MESSAGE}</p>
        <div className="reset-dialog__actions">
          <button ref={first} type="button" className="btn btn--play btn--sm" onClick={onClose}>
            Done
          </button>
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog title="Sign in your TV?">
      <div className="sync-code" aria-label={`TV code ${code.split('').join(' ')}`}>{groupTvCode(code)}</div>
      <p>Signing in as {status.email ?? 'this guest space'}.</p>
      <p>The TV will show your profiles and keep your progress in sync.</p>
      {result && !result.ok && <p role="alert" className="reset-dialog__error">{approveErrorMessage(result.error)}</p>}
      <div className="reset-dialog__actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
          Cancel
        </button>
        <button ref={first} type="button" className="btn btn--play btn--sm" disabled={busy} onClick={() => void approve()}>
          {busy ? 'Approving…' : 'Approve'}
        </button>
      </div>
    </Dialog>
  );
}

/** The code from the QR link: once signed in (and on an adult profile) ask, then approve. */
export function TvApprovePrompt() {
  const captured = useCapturedTvCode();
  const [code, setCode] = useState<string | null>(captured);
  const status = useSyncStatus();
  const profiles = useProfiles();
  const close = () => {
    clearPendingTv(sessionStore());
    setCode(null);
  };
  if (!code || !syncEnabled() || !status.linked || status.gettingProfiles || profiles.picker) return null;
  if (!capabilities(profileStore.active()).sync) {
    return (
      <Dialog title="Use an adult profile">
        <p>{KIDS_MESSAGE}</p>
        <div className="reset-dialog__actions">
          <button type="button" className="btn btn--play btn--sm" autoFocus onClick={close}>
            OK
          </button>
        </div>
      </Dialog>
    );
  }
  return <TvApproveDialog code={code} onClose={close} />;
}

/** Settings row for when the camera cannot scan the TV's QR code. */
export function SignInTvRow() {
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  useProfiles();
  if (!syncEnabled() || !capabilities(profileStore.active()).sync) return null;
  const code = normalizeCode(input);
  return (
    <form
      className="field"
      onSubmit={(e) => {
        e.preventDefault();
        if (isCompleteCode(code)) setOpen(true);
      }}
    >
      <label className="field__text" htmlFor="tv-code">
        <span className="field__label">Sign in a TV</span>
        <span className="field__hint">Scan the QR code on the TV with your camera, or type the code the TV shows.</span>
      </label>
      <div className="sync-row">
        <input
          id="tv-code"
          className="select sync-input sync-input--code"
          value={input}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          placeholder="XXXX-XXXX"
          maxLength={CODE_LENGTH + 6}
          onChange={(e) => setInput(e.target.value.toUpperCase())}
        />
        <button type="submit" className="btn btn--info btn--sm" disabled={!isCompleteCode(code)}>
          Sign in a TV
        </button>
      </div>
      {open && (
        <TvApproveDialog
          code={code}
          onClose={() => {
            setOpen(false);
            setInput('');
          }}
        />
      )}
    </form>
  );
}
