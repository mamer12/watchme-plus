/** The signed-out screen (Netflix-like): Sign in, Create account, Continue as guest. Also the forms, the "add this device's
 * data?" question, the reset-password screen and the "Getting your profiles…" splash. Keyboard and remote friendly. */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Logo } from '../components/Logo';
import { Spinner } from '../components/Skeleton';
import { AttemptLimiter, MIN_PASSWORD, accountErrorMessage, recoveryEnabled, type AccountResult, type MergeChoice } from './accounts';
import { loadSyncService } from './runtime';
import { clearRecovery, useRecovery } from './recovery';
import type { SyncService } from './service';
import { useSyncStatus } from './status';

export function reloadApp(): void {
  window.location.replace('/');
}

/** Runs an account action: one at a time, a wait after a failure, and a friendly message instead of the server's. */
export function useAccountAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const limiter = useRef(new AttemptLimiter(() => Date.now()));
  const wait = Math.ceil(limiter.current.waitMs() / 1000);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [wait > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  void now;

  const run = async (fn: (s: SyncService) => Promise<AccountResult>): Promise<boolean> => {
    if (busy || limiter.current.waitMs() > 0) return false;
    setBusy(true);
    setError(null);
    try {
      const res = await fn(await loadSyncService());
      if (res.ok) {
        limiter.current.succeeded();
        if (res.reload) reloadApp();
        return true;
      }
      if (res.error !== 'cancelled') {
        limiter.current.failed();
        setError(accountErrorMessage(res.error));
      }
      return false;
    } catch {
      limiter.current.failed();
      setError(accountErrorMessage('error'));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, wait, run, setError };
}

export function MergeDialog({ onChoose }: { onChoose: (c: MergeChoice) => void }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onChoose('cancel');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onChoose]);
  return (
    <div className="modal-backdrop" data-nav-scope>
      <div className="modal reset-dialog" role="alertdialog" aria-modal="true" aria-labelledby="merge-title" aria-describedby="merge-desc">
        <h2 id="merge-title">Add this device's data to your account?</h2>
        <div id="merge-desc">
          <p>This device already has a library of its own. Add it to your account and your My List, ratings and progress are combined with what is already there.</p>
          <p>Choose Skip to use only what is in your account; this device's own library is removed from here.</p>
        </div>
        <div className="reset-dialog__actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChoose('cancel')}>
            Cancel
          </button>
          <button type="button" className="btn btn--info btn--sm" onClick={() => onChoose('skip')}>
            Skip
          </button>
          <button ref={first} type="button" className="btn btn--play btn--sm" onClick={() => onChoose('merge')}>
            Add it
          </button>
        </div>
      </div>
    </div>
  );
}

type Mode = 'home' | 'signin' | 'create' | 'forgot';

function Field(props: { id: string; label: string; type?: string; value: string; onChange: (v: string) => void; autoComplete: string; autoFocus?: boolean; hint?: string }) {
  return (
    <div className="auth-field">
      <label htmlFor={props.id}>{props.label}</label>
      <input
        id={props.id}
        name={props.id}
        className="auth-input"
        type={props.type ?? 'text'}
        value={props.value}
        autoComplete={props.autoComplete}
        autoFocus={props.autoFocus}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={256}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.hint && <span className="field__hint">{props.hint}</span>}
    </div>
  );
}

function AuthForm({ mode, onBack, onForgot }: { mode: 'signin' | 'create' | 'forgot'; onBack: () => void; onForgot?: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [sent, setSent] = useState(false);
  const [merge, setMerge] = useState<((c: MergeChoice) => void) | null>(null);
  const { busy, error, wait, run } = useAccountAction();
  const create = mode === 'create';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !merge) onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack, merge]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const ok = await run((s) => {
      if (mode === 'forgot') return s.accounts.forgotPassword(email);
      if (create) return s.accounts.createAccount(email, password, again);
      return s.accounts.signIn(email, password, () => new Promise<MergeChoice>((resolve) => setMerge(() => (c: MergeChoice) => (setMerge(null), resolve(c)))));
    });
    if (ok && mode === 'forgot') setSent(true);
    if (ok) setPassword('');
  }

  const title = mode === 'forgot' ? 'Reset your password' : create ? 'Create account' : 'Sign in';
  return (
    <form className="auth-card" onSubmit={(e) => void submit(e)} aria-labelledby="auth-title" data-nav-scope>
      <h1 id="auth-title">{title}</h1>
      {sent ? (
        <p role="status">If that email has an account, a link to choose a new password is on its way.</p>
      ) : (
        <>
          <Field id="auth-email" label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" autoFocus />
          {mode !== 'forgot' && (
            <Field
              id="auth-password"
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete={create ? 'new-password' : 'current-password'}
              hint={create ? `At least ${MIN_PASSWORD} characters.` : undefined}
            />
          )}
          {create && <Field id="auth-again" label="Repeat password" type="password" value={again} onChange={setAgain} autoComplete="new-password" />}
          {error && (
            <p id="auth-error" role="alert" className="auth-error">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn--play auth-submit" disabled={busy || wait > 0 || !email || (mode !== 'forgot' && !password)}>
            {busy ? 'Please wait…' : wait > 0 ? `Try again in ${wait} s` : mode === 'forgot' ? 'Send reset link' : title}
          </button>
          {mode === 'signin' && onForgot && (
            <button type="button" className="auth-link" onClick={onForgot}>
              Forgot password?
            </button>
          )}
        </>
      )}
      <button type="button" className="auth-link" onClick={onBack}>
        {sent ? 'Back to sign in' : 'Back'}
      </button>
      {merge && <MergeDialog onChoose={merge} />}
    </form>
  );
}

export function WelcomeScreen() {
  const [mode, setMode] = useState<Mode>('home');
  const { busy, error, run } = useAccountAction();
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (mode === 'home') first.current?.focus();
  }, [mode]);

  const guest = () => void run(async (s) => {
    const res = await s.startSpace('');
    return res.ok ? { ok: true } : { ok: false, error: res.error === 'network' ? 'offline' : 'error' };
  });

  return (
    <div className="welcome" data-nav-scope>
      <header className="welcome__top">
        <Logo />
      </header>
      {mode === 'home' ? (
        <main className="welcome__main">
          <h1 className="welcome__title">Watch anywhere. Pick up where you left off.</h1>
          <p className="welcome__sub">Sign in with the same email and password on every device and your profiles, My List and progress follow you.</p>
          <div className="welcome__actions">
            <button ref={first} type="button" className="btn btn--play" onClick={() => setMode('signin')}>
              Sign in
            </button>
            <button type="button" className="btn btn--info" onClick={() => setMode('create')}>
              Create account
            </button>
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={guest}>
              {busy ? 'Getting ready…' : 'Continue as guest'}
            </button>
          </div>
          {error && (
            <p role="alert" className="auth-error">
              {error}
            </p>
          )}
          <p className="field__hint">A guest keeps a private library on this device and can link other devices with a code. You can create an account later without losing anything.</p>
        </main>
      ) : (
        <div className="welcome__main">
          <AuthForm key={mode} mode={mode} onBack={() => setMode(mode === 'forgot' ? 'signin' : 'home')} onForgot={recoveryEnabled() ? () => setMode('forgot') : undefined} />
        </div>
      )}
    </div>
  );
}

/** Shown while the first sync after signing in brings the profiles and the active profile's rows. */
export function GettingProfiles() {
  return (
    <div className="welcome welcome--center" role="status">
      <Spinner label="Getting your profiles" />
      <p>Getting your profiles…</p>
    </div>
  );
}

export function RecoveryScreen() {
  const r = useRecovery();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const { busy, error, wait, run } = useAccountAction();
  if (!r) return null;
  return (
    <div className="welcome" data-nav-scope>
      <header className="welcome__top">
        <Logo />
      </header>
      <form
        className="auth-card"
        onSubmit={(e) => {
          e.preventDefault();
          void run((s) => s.accounts.completeRecovery(r, password, again)).then((ok) => {
            if (ok) {
              setPassword('');
              setAgain('');
              clearRecovery();
            }
          });
        }}
      >
        <h1>Set a new password</h1>
        {r.email && <p className="field__hint">For {r.email}</p>}
        <Field id="rec-password" label="New password" type="password" value={password} onChange={setPassword} autoComplete="new-password" autoFocus hint={`At least ${MIN_PASSWORD} characters.`} />
        <Field id="rec-again" label="Repeat new password" type="password" value={again} onChange={setAgain} autoComplete="new-password" />
        {error && (
          <p role="alert" className="auth-error">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--play auth-submit" disabled={busy || wait > 0 || !password}>
          {busy ? 'Please wait…' : wait > 0 ? `Try again in ${wait} s` : 'Save and continue'}
        </button>
        <button type="button" className="auth-link" onClick={clearRecovery}>
          Cancel
        </button>
      </form>
    </div>
  );
}

export const useGettingProfiles = (): boolean => useSyncStatus().gettingProfiles;
