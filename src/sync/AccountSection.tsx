/** Settings -> Account: who is signed in, sign out, change password, delete account, or turn a guest into an account. */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { DELETE_WORD, MIN_PASSWORD, deleteConfirmed, type MergeChoice } from './accounts';
import { syncEnabled } from './config';
import { useSyncStatus } from './status';
import { SignInTvRow } from './TvApprove';
import { MergeDialog, useAccountAction } from './Welcome';

type Panel = null | 'create' | 'signin' | 'password' | 'signout' | 'delete';

function Dialog({ id, title, onClose, children }: { id: string; title: string; onClose: () => void; children: React.ReactNode }) {
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
  return (
    <div className="modal-backdrop" data-nav-scope onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal reset-dialog" role="alertdialog" aria-modal="true" aria-labelledby={id}>
        <h2 id={id}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function PasswordInputs({ password, again, setPassword, setAgain, label = 'Password' }: { password: string; again: string; setPassword: (v: string) => void; setAgain: (v: string) => void; label?: string }) {
  return (
    <>
      <div className="auth-field">
        <label htmlFor="acc-pw">{label}</label>
        <input id="acc-pw" className="auth-input" type="password" autoComplete="new-password" autoFocus value={password} maxLength={256} onChange={(e) => setPassword(e.target.value)} />
        <span className="field__hint">At least {MIN_PASSWORD} characters.</span>
      </div>
      <div className="auth-field">
        <label htmlFor="acc-pw2">Repeat password</label>
        <input id="acc-pw2" className="auth-input" type="password" autoComplete="new-password" value={again} maxLength={256} onChange={(e) => setAgain(e.target.value)} />
      </div>
    </>
  );
}

export function AccountSection() {
  const status = useSyncStatus();
  const [panel, setPanel] = useState<Panel>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [typed, setTyped] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [merge, setMerge] = useState<((c: MergeChoice) => void) | null>(null);
  const { busy, error, wait, run, setError } = useAccountAction();
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), [panel]);

  if (!syncEnabled() || !status.linked) return null;
  const account = status.email;

  const close = () => {
    setPanel(null);
    setPassword('');
    setAgain('');
    setTyped('');
    setError(null);
  };
  const submit = (fn: Parameters<typeof run>[0], message?: string) => async (e: FormEvent) => {
    e.preventDefault();
    if (await run(fn)) {
      if (message) setDone(message);
      close();
    }
  };
  const submitBtn = (label: string, disabled: boolean, danger = false) => (
    <button type="submit" className={`btn btn--sm ${danger ? 'btn--danger' : 'btn--play'}`} disabled={busy || wait > 0 || disabled}>
      {busy ? 'Please wait…' : wait > 0 ? `Try again in ${wait} s` : label}
    </button>
  );
  const err = error && (
    <p role="alert" className="reset-dialog__error">
      {error}
    </p>
  );

  return (
    <section className="settings-group" aria-labelledby="account-title">
      <h2 id="account-title">Account</h2>
      <div className="field">
        <div className="field__text">
          <span className="field__label">{account ?? 'Guest'}</span>
          <span className="field__hint">
            {account ? 'Sign in with this email and password on any device and everything follows you.' : 'Create an account to sign in on every device with an email and password. Your library here is kept.'}
          </span>
        </div>
        {!account && (
          <div className="sync-row">
            <button type="button" className="btn btn--info btn--sm" onClick={() => setPanel('signin')}>
              Sign in
            </button>
            <button type="button" className="btn btn--info btn--sm" onClick={() => setPanel('create')}>
              Create account
            </button>
          </div>
        )}
      </div>
      {done && <p role="status" className="field__hint">{done}</p>}
      {account && <SignInTvRow />}
      {account && (
        <div className="field">
          <div className="field__text">
            <span className="field__label">Password</span>
          </div>
          <button type="button" className="btn btn--info btn--sm" onClick={() => setPanel('password')}>
            Change password
          </button>
        </div>
      )}
      {account && (
        <div className="field">
          <div className="field__text">
            <span className="field__label">Sign out</span>
            <span className="field__hint">Removes this device's copy. Your data stays in your account.</span>
          </div>
          <button type="button" className="btn btn--info btn--sm" onClick={() => setPanel('signout')}>
            Sign out
          </button>
        </div>
      )}
      <div className="field">
        <div className="field__text">
          <span className="field__label">Delete account</span>
          <span className="field__hint">Removes {account ? 'your account' : 'this guest library'} and everything synced from the server. It cannot be undone.</span>
        </div>
        <button type="button" className="btn btn--danger btn--sm" onClick={() => setPanel('delete')}>
          Delete account
        </button>
      </div>

      {panel === 'create' && (
        <Dialog id="acc-create" title="Create account" onClose={close}>
          <form onSubmit={(e) => void submit((s) => s.accounts.createAccount(email, password, again), 'Account created. Sign in with it on your other devices.')(e)}>
            <div className="auth-field">
              <label htmlFor="acc-email">Email</label>
              <input id="acc-email" className="auth-input" type="email" autoComplete="email" autoFocus value={email} maxLength={256} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <PasswordInputs password={password} again={again} setPassword={setPassword} setAgain={setAgain} />
            {err}
            <div className="reset-dialog__actions">
              <button ref={cancel} type="button" className="btn btn--ghost btn--sm" onClick={close}>
                Cancel
              </button>
              {submitBtn('Create account', !email || !password)}
            </div>
          </form>
        </Dialog>
      )}
      {panel === 'signin' && (
        <Dialog id="acc-signin" title="Sign in to your account" onClose={() => !merge && close()}>
          <form
            onSubmit={(e) =>
              void submit((s) => s.accounts.signIn(email, password, () => new Promise<MergeChoice>((resolve) => setMerge(() => (c: MergeChoice) => (setMerge(null), resolve(c))))))(e)
            }
          >
            <p className="field__hint">Use an account you already have. This guest library can be added to it.</p>
            <div className="auth-field">
              <label htmlFor="acc-email-in">Email</label>
              <input id="acc-email-in" className="auth-input" type="email" autoComplete="email" autoFocus value={email} maxLength={256} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="auth-field">
              <label htmlFor="acc-pw-in">Password</label>
              <input id="acc-pw-in" className="auth-input" type="password" autoComplete="current-password" value={password} maxLength={256} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {err}
            <div className="reset-dialog__actions">
              <button ref={cancel} type="button" className="btn btn--ghost btn--sm" onClick={close}>
                Cancel
              </button>
              {submitBtn('Sign in', !email || !password)}
            </div>
          </form>
          {merge && <MergeDialog onChoose={merge} />}
        </Dialog>
      )}
      {panel === 'password' && (
        <Dialog id="acc-pw-title" title="Change password" onClose={close}>
          <form onSubmit={(e) => void submit((s) => s.accounts.changePassword(password, again), 'Password changed.')(e)}>
            <PasswordInputs password={password} again={again} setPassword={setPassword} setAgain={setAgain} label="New password" />
            {err}
            <div className="reset-dialog__actions">
              <button ref={cancel} type="button" className="btn btn--ghost btn--sm" onClick={close}>
                Cancel
              </button>
              {submitBtn('Change password', !password)}
            </div>
          </form>
        </Dialog>
      )}
      {panel === 'signout' && (
        <Dialog id="acc-out" title="Sign out of this device?" onClose={close}>
          <p>Your data stays in your account. This device's copy of your library is removed, and you can sign in again at any time.</p>
          {err}
          <div className="reset-dialog__actions">
            <button ref={cancel} type="button" className="btn btn--info btn--sm" onClick={close}>
              Cancel
            </button>
            <button type="button" className="btn btn--danger btn--sm" disabled={busy} onClick={() => void run((s) => s.accounts.signOut())}>
              {busy ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </Dialog>
      )}
      {panel === 'delete' && (
        <Dialog id="acc-del" title="Delete account?" onClose={close}>
          <form onSubmit={(e) => void submit((s) => s.accounts.deleteAccount(typed))(e)}>
            <p>This permanently deletes {account ? 'your account' : 'this guest library'}, its profiles, My List, ratings and progress, on every device. It cannot be undone.</p>
            <div className="auth-field">
              <label htmlFor="acc-word">Type {DELETE_WORD} to confirm</label>
              <input id="acc-word" className="auth-input" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={typed} maxLength={20} onChange={(e) => setTyped(e.target.value)} />
            </div>
            {err}
            <div className="reset-dialog__actions">
              <button ref={cancel} type="button" className="btn btn--info btn--sm" onClick={close}>
                Cancel
              </button>
              {submitBtn('Delete account', !deleteConfirmed(typed), true)}
            </div>
          </form>
        </Dialog>
      )}
    </section>
  );
}
