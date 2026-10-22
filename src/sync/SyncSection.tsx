import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { CODE_LENGTH, PAIRING_TTL_MS, deviceNameFromUA, formatCode, isCompleteCode, joinErrorMessage, joinUrl, normalizeCode } from './codes';
import { syncEnabled } from './config';
import { loadSyncService } from './runtime';
import type { DeviceRow, SyncService } from './service';
import { statusText, useSyncStatus } from './status';

const QrCode = lazy(() => import('./QrCode'));

function useTick(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const mmss = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function PairingPanel({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [madeAt, setMadeAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const now = useTick(1000);
  const alive = useRef(true);

  const make = useCallback(async () => {
    setError(null);
    setCode(null);
    try {
      const s = await loadSyncService();
      const c = await s.newPairingCode();
      if (!alive.current) return;
      setCode(c);
      setMadeAt(Date.now());
    } catch {
      if (alive.current) setError('Could not get a code. Check your connection and try again.');
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void make();
    return () => {
      alive.current = false;
    };
  }, [make]);

  const left = code ? madeAt + PAIRING_TTL_MS - now : 0;
  const expired = !!code && left <= 0;
  return (
    <div className="sync-pair" role="region" aria-label="Link a guest device">
      {error && <p role="alert" className="sync-error">{error}</p>}
      {!code && !error && <p role="status">Getting a code…</p>}
      {code && !expired && (
        <>
          <p className="field__hint">On the other device open Settings, Sync, Join with a code and type:</p>
          <div className="sync-code" aria-label={`Pairing code ${code.split('').join(' ')}`}>{formatCode(code)}</div>
          <p className="sync-countdown" role="timer">Expires in {mmss(left)}</p>
          <Suspense fallback={<div className="sync-qr sync-qr--loading" />}>
            <QrCode text={joinUrl(code)} label="QR code that opens Watchme+ and joins this space" />
          </Suspense>
          <p className="field__hint">Or scan the QR code with the other device's camera. The code works once.</p>
        </>
      )}
      {expired && <p role="status">That code expired.</p>}
      <div className="sync-row">
        {(expired || error) && (
          <button type="button" className="btn btn--info btn--sm" onClick={() => void make()}>
            New code
          </button>
        )}
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

function DeleteDialog({ onClose, onConfirm, busy }: { onClose: () => void; onConfirm: () => void; busy: boolean }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancel.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" data-nav-scope onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal reset-dialog" role="alertdialog" aria-modal="true" aria-labelledby="sync-del-title" aria-describedby="sync-del-desc">
        <h2 id="sync-del-title">Delete all synced data?</h2>
        <div id="sync-del-desc">
          <p>This removes your synced progress, My List, ratings and settings from the sync service. It cannot be undone.</p>
          <p>Every device keeps its own copy. Devices stay connected, and anything you change afterwards syncs again.</p>
        </div>
        <div className="reset-dialog__actions">
          <button ref={cancel} type="button" className="btn btn--info btn--sm" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--danger btn--sm" disabled={busy} onClick={onConfirm}>
            {busy ? 'Deleting…' : 'Delete synced data'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SyncSection() {
  const status = useSyncStatus();
  const now = useTick(15_000);
  const [name, setName] = useState(() => (typeof navigator === 'undefined' ? 'Browser' : deviceNameFromUA(navigator.userAgent, { touchPoints: navigator.maxTouchPoints })));
  const [codeInput, setCodeInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [pairing, setPairing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleted, setDeleted] = useState(false);

  const linked = status.linked;
  const account = !!status.email;
  const lastSyncAt = status.lastSyncAt;
  useEffect(() => {
    if (!linked) {
      setDevices(null);
      return;
    }
    let alive = true;
    void loadSyncService()
      .then((s) => s.listDevices())
      .then((d) => alive && setDevices(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [linked, lastSyncAt === null]);

  if (!syncEnabled()) return null;

  const run = async (fn: (s: SyncService) => Promise<{ ok: boolean; error?: string } | void>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fn(await loadSyncService());
      if (res && !res.ok) setError(joinErrorMessage(res.error ?? 'error'));
    } catch {
      setError(joinErrorMessage('error'));
    } finally {
      setBusy(false);
    }
  };

  const chipClass = status.phase === 'error' ? 'sync-chip sync-chip--error' : status.phase === 'offline' ? 'sync-chip sync-chip--warn' : 'sync-chip';
  const code = normalizeCode(codeInput);

  return (
    <section className="settings-group" aria-labelledby="sync-title">
      <h2 id="sync-title">Sync</h2>
      {!linked ? (
        <>
          <div className="field">
            <div className="field__text">
              <span className="field__label">Keep this library on all your devices</span>
              <span className="field__hint">No account needed. Progress, My List, ratings and viewing preferences follow you; quality and volume stay per device.</span>
            </div>
          </div>
          <div className="field">
            <label className="field__text" htmlFor="sync-device">
              <span className="field__label">Device name</span>
              <span className="field__hint">Shown on your other devices, like "Continued from {name || 'Phone'}".</span>
            </label>
            <input id="sync-device" className="select sync-input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <div className="field__text">
              <span className="field__label">First device</span>
              <span className="field__hint">Creates your private sync space. Add the others with a code.</span>
            </div>
            <button type="button" className="btn btn--info btn--sm" disabled={busy} onClick={() => void run((s) => s.startSpace(name))}>
              Start syncing on this device
            </button>
          </div>
          <form
            className="field"
            onSubmit={(e) => {
              e.preventDefault();
              if (isCompleteCode(code)) void run((s) => s.join(code, name));
            }}
          >
            <label className="field__text" htmlFor="sync-code">
              <span className="field__label">Already syncing somewhere?</span>
              <span className="field__hint">On the other device choose Link a guest device, then type the code here.</span>
            </label>
            <div className="sync-row">
              <input
                id="sync-code"
                className="select sync-input sync-input--code"
                value={codeInput}
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                placeholder="XXXX-XXXX"
                maxLength={CODE_LENGTH + 6}
                aria-describedby={error ? 'sync-err' : undefined}
                onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              />
              <button type="submit" className="btn btn--info btn--sm" disabled={busy || !isCompleteCode(code)}>
                Join with a code
              </button>
            </div>
          </form>
        </>
      ) : (
        <>
          <div className="field">
            <div className="field__text">
              <span className="field__label">This device: {status.deviceName || name}</span>
              <span className="field__hint">
                {status.pending > 0 ? `${status.pending} change${status.pending === 1 ? '' : 's'} waiting to be sent` : 'Everything on this device is sent'}
              </span>
            </div>
            <span className={chipClass} role="status">{statusText(status, now)}</span>
          </div>
          <div className="field">
            <div className="field__text">
              <span className="field__label">Devices</span>
              {devices === null ? (
                <span className="field__hint">Loading…</span>
              ) : (
                <ul className="sync-devices">
                  {devices.map((d, i) => (
                    <li key={i}>
                      {d.device_name || 'Device'}
                      {d.is_me && <span className="sync-me"> (this device)</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {!account && (
              <button type="button" className="btn btn--info btn--sm" aria-expanded={pairing} onClick={() => setPairing((v) => !v)}>
                Link a guest device
              </button>
            )}
          </div>
          {pairing && !account && <PairingPanel onClose={() => setPairing(false)} />}
          {!account && <div className="field">
            <div className="field__text">
              <span className="field__label">Disconnect this device</span>
              <span className="field__hint">Stops syncing here. Your library on this device stays; the other devices keep syncing.</span>
            </div>
            <button
              type="button"
              className="btn btn--info btn--sm"
              disabled={busy}
              onClick={() => {
                if (window.confirm('Disconnect this device from sync? Your library here is kept.')) void run((s) => s.disconnect());
              }}
            >
              Disconnect this device
            </button>
          </div>}
          <div className="field">
            <div className="field__text">
              <span className="field__label">Delete all synced data</span>
              <span className="field__hint">{deleted ? 'Deleted from the sync service.' : 'Removes everything stored in the sync service. Devices keep their own copies.'}</span>
            </div>
            <button type="button" className="btn btn--danger btn--sm" onClick={() => setConfirmDelete(true)}>
              Delete all synced data
            </button>
          </div>
        </>
      )}
      {error && <p id="sync-err" role="alert" className="sync-error">{error}</p>}
      {confirmDelete && (
        <DeleteDialog
          busy={busy}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() =>
            void run(async (s) => {
              await s.deleteServerData();
              setDeleted(true);
              setConfirmDelete(false);
            })
          }
        />
      )}
    </section>
  );
}
