/** Add or edit one profile: name, colour, avatar, Kids, PIN; delete with a confirmation. */
import { useEffect, useRef, useState } from 'react';
import { syncEnabled } from '../sync/config';
import { useSyncStatus } from '../sync/status';
import { Avatar, COLOR_NAMES, PROFILE_COLORS } from './Avatar';
import { PinPad } from './PinPad';
import { hashPin } from './pin';
import { profileStore } from './singleton';
import { AVATARS, NAME_MAX, type AvatarKey, type PinRecord, type Profile } from './types';

type PinDraft = PinRecord | null | undefined; // undefined = unchanged

const ERRORS: Record<string, string> = { name: 'Give the profile a name (1 to 20 characters).', max: 'You can have up to 6 profiles.', last: 'You need at least one profile.', color: 'Pick a colour.', avatar: 'Pick an avatar.', missing: 'That profile no longer exists.' };

function DeleteConfirm({ profile, onCancel, onDone }: { profile: Profile; onCancel: () => void; onDone: () => void }) {
  const [purge, setPurge] = useState(false);
  const sync = useSyncStatus();
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  return (
    <div className="modal-backdrop" data-nav-scope>
      <div className="modal reset-dialog" role="alertdialog" aria-modal="true" aria-labelledby="del-title">
        <h2 id="del-title">Delete {profile.name}?</h2>
        <p>Its My List, ratings, progress and viewing preferences are removed from this device. This cannot be undone.</p>
        {syncEnabled() && sync.linked && (
          <label className="check">
            <input type="checkbox" checked={purge} onChange={(e) => setPurge(e.target.checked)} />
            <span>Also delete its synced data</span>
          </label>
        )}
        <div className="reset-dialog__actions">
          <button ref={cancel} type="button" className="btn btn--info btn--sm" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--danger btn--sm"
            onClick={() => {
              profileStore.remove(profile.id, purge);
              onDone();
            }}
          >
            Delete profile
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProfileEditor({ profile, onClose }: { profile: Profile | null; onClose: () => void }) {
  const isNew = !profile;
  const used = profileStore.live().length;
  const [name, setName] = useState(profile?.name ?? '');
  const [color, setColor] = useState(profile?.color ?? used % PROFILE_COLORS.length);
  const [avatar, setAvatar] = useState<AvatarKey>(profile?.avatar ?? AVATARS[used % AVATARS.length]!);
  const [kids, setKids] = useState(profile?.kids ?? false);
  const [pin, setPin] = useState<PinDraft>(undefined);
  const [step, setStep] = useState<'form' | 'pin1' | 'pin2' | 'delete'>('form');
  const [first, setFirst] = useState('');
  const [error, setError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);

  const hasPin = pin === undefined ? !!profile?.pin : pin !== null;

  useEffect(() => {
    if (step !== 'form') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, onClose]);

  function save() {
    const patch = { name, color, avatar, kids, ...(pin !== undefined ? { pin } : {}) };
    if (isNew) {
      const r = profileStore.add({ ...patch, pin: pin ?? null });
      if (!r.ok) return setError(ERRORS[r.error] ?? 'Could not save.');
    } else {
      const e = profileStore.edit(profile.id, patch);
      if (e) return setError(ERRORS[e] ?? 'Could not save.');
    }
    onClose();
  }

  if (step === 'pin1' || step === 'pin2') {
    return (
      <PinPad
        key={step}
        title={step === 'pin1' ? 'Choose a PIN' : 'Enter it again'}
        subtitle={step === 'pin1' ? '4 to 6 digits. It will be asked to open this profile.' : undefined}
        submitLabel={step === 'pin1' ? 'Next' : 'Set PIN'}
        onCancel={() => setStep('form')}
        onSubmit={async (v) => {
          if (step === 'pin1') {
            setFirst(v);
            setStep('pin2');
            return { ok: true };
          }
          if (v !== first) {
            setStep('pin1');
            setError('The two PINs were different. Try again.');
            return { ok: true };
          }
          setPin(await hashPin(v));
          setError('');
          setStep('form');
          return { ok: true };
        }}
      />
    );
  }

  return (
    <div className="modal-backdrop" data-nav-scope={step === 'delete' ? undefined : ''}>
      <div className="modal profile-editor" role="dialog" aria-modal="true" aria-labelledby="pe-title">
        <h2 id="pe-title">{isNew ? 'Add profile' : 'Edit profile'}</h2>
        <div className="profile-editor__head">
          <Avatar avatar={avatar} color={color} size={88} />
          <label className="profile-editor__name">
            <span>Name</span>
            <input ref={nameRef} className="input" value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
          </label>
        </div>

        <div className="profile-editor__group" role="radiogroup" aria-label="Colour">
          {PROFILE_COLORS.map((c, i) => (
            <button key={c} type="button" role="radio" aria-checked={i === color} aria-label={COLOR_NAMES[i]} className={`swatch ${i === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(i)} />
          ))}
        </div>
        <div className="profile-editor__group" role="radiogroup" aria-label="Avatar">
          {AVATARS.map((a) => (
            <button key={a} type="button" role="radio" aria-checked={a === avatar} aria-label={a} className={`avatar-pick ${a === avatar ? 'on' : ''}`} onClick={() => setAvatar(a)}>
              <Avatar avatar={a} color={color} size={44} />
            </button>
          ))}
        </div>

        <div className="field">
          <div className="field__text">
            <span className="field__label">Kids profile</span>
            <span className="field__hint">Family-friendly titles only, flagged scenes skipped, no Settings. A PIN is needed to leave it.</span>
          </div>
          <div className="field__control">
            <button type="button" role="switch" aria-checked={kids} aria-label="Kids profile" className={`switch ${kids ? 'on' : ''}`} onClick={() => setKids(!kids)}>
              <span />
            </button>
          </div>
        </div>
        <div className="field">
          <div className="field__text">
            <span className="field__label">PIN</span>
            <span className="field__hint">{hasPin ? 'This profile asks for a PIN to open.' : 'Optional. Asked every time this profile opens.'}</span>
          </div>
          <div className="field__control profile-editor__pin">
            <button type="button" className="btn btn--info btn--sm" onClick={() => setStep('pin1')}>
              {hasPin ? 'Change PIN' : 'Set PIN'}
            </button>
            {hasPin && (
              <button type="button" className="btn btn--info btn--sm" onClick={() => setPin(null)}>
                Remove PIN
              </button>
            )}
          </div>
        </div>

        <p className="profile-editor__error" role="alert">
          {error}
        </p>
        <div className="reset-dialog__actions">
          {!isNew && used > 1 && (
            <button type="button" className="btn btn--danger btn--sm profile-editor__delete" onClick={() => setStep('delete')}>
              Delete profile
            </button>
          )}
          <button type="button" className="btn btn--info btn--sm" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--play btn--sm" onClick={save}>
            Save
          </button>
        </div>
      </div>
      {step === 'delete' && profile && <DeleteConfirm profile={profile} onCancel={() => setStep('form')} onDone={onClose} />}
    </div>
  );
}
