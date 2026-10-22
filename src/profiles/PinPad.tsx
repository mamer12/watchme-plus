/** A big on-screen keypad for 4 to 6 digits. Works with touch, a keyboard (digits, Backspace, Enter, Escape) and TV-remote arrows. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PinResult } from './pinGate';

export const PIN_MIN = 4;
export const PIN_MAX = 6;

const mmss = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function PinPad({
  title,
  subtitle,
  submitLabel = 'OK',
  onSubmit,
  onCancel,
  lockedMs = 0,
}: {
  title: string;
  subtitle?: string;
  submitLabel?: string;
  /** Resolve with a result to show a wrong-PIN or locked message, or { ok: true } to finish. */
  onSubmit: (pin: string) => Promise<PinResult>;
  onCancel: () => void;
  lockedMs?: number;
}) {
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [lockUntil, setLockUntil] = useState(() => (lockedMs > 0 ? Date.now() + lockedMs : 0));
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);
  const first = useRef<HTMLButtonElement>(null);
  const left = Math.max(0, lockUntil - now);
  const locked = left > 0;

  useEffect(() => {
    alive.current = true;
    first.current?.focus();
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!lockUntil) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [lockUntil]);

  const submit = useCallback(
    async (value: string) => {
      if (busy || locked || value.length < PIN_MIN) return;
      setBusy(true);
      try {
        const r = await onSubmit(value);
        if (!alive.current || r.ok) return;
        setPin('');
        if (r.locked) {
          setLockUntil(Date.now() + r.remainingMs);
          setNow(Date.now());
          setMessage('');
        } else {
          setMessage(`Wrong PIN. ${r.triesLeft} ${r.triesLeft === 1 ? 'try' : 'tries'} left.`);
        }
      } catch {
        if (alive.current) {
          setPin('');
          setMessage('Could not check the PIN here. Open Watchme+ over a secure connection.');
        }
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [busy, locked, onSubmit],
  );

  const add = (d: string) => {
    if (busy || locked) return;
    setMessage('');
    setPin((p) => (p.length < PIN_MAX ? p + d : p));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        add(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setPin((p) => p.slice(0, -1));
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter' && pin.length >= PIN_MIN && !(e.target as HTMLElement | null)?.closest('button:not([data-digit])')) {
        // On a digit key Enter confirms once there are enough digits; on Cancel, Delete or OK it presses that button.
        e.preventDefault();
        void submit(pin);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="modal-backdrop pin-backdrop" data-nav-scope>
      <div className="modal pin-pad" role="dialog" aria-modal="true" aria-labelledby="pin-title">
        <h2 id="pin-title">{title}</h2>
        {subtitle && <p className="pin-pad__sub">{subtitle}</p>}
        <div className="pin-pad__dots" role="status" aria-label={`${pin.length} digits entered`}>
          {Array.from({ length: PIN_MAX }, (_, i) => (
            <span key={i} className={i < pin.length ? 'on' : ''} />
          ))}
        </div>
        <p className="pin-pad__msg" role="alert">
          {locked ? `Too many tries. Try again in ${mmss(left)}.` : message}
        </p>
        <div className="pin-pad__keys">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d, i) => (
            <button key={d} ref={i === 0 ? first : undefined} data-digit type="button" className="pin-key" disabled={locked} onClick={() => add(d)}>
              {d}
            </button>
          ))}
          <button type="button" className="pin-key pin-key--small" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" data-digit className="pin-key" disabled={locked} onClick={() => add('0')}>
            0
          </button>
          <button type="button" className="pin-key pin-key--small" aria-label="Delete last digit" disabled={locked || !pin} onClick={() => setPin((p) => p.slice(0, -1))}>
            ⌫
          </button>
        </div>
        <button type="button" className="btn btn--play pin-pad__ok" disabled={locked || busy || pin.length < PIN_MIN} onClick={() => void submit(pin)}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
