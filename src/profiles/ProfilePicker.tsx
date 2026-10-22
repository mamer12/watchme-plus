/** "Who's watching?": the full-screen profile picker, with a manage mode. Keyboard and TV-remote friendly. */
import { useEffect, useState } from 'react';
import { Avatar } from './Avatar';
import { GuardianPad } from './Guardian';
import { PinPad } from './PinPad';
import { lockLeft } from './pinGate';
import { ProfileEditor } from './ProfileEditor';
import { profileStore, useProfiles } from './singleton';
import { liveProfiles } from './logic';
import { MAX_PROFILES, type Profile } from './types';

type Modal = null | { kind: 'pin'; profile: Profile } | { kind: 'guardian' } | { kind: 'edit'; profile: Profile | null };

export function ProfilePicker() {
  const view = useProfiles();
  const [modal, setModal] = useState<Modal>(null);
  const live = liveProfiles(view.list);
  const manage = !!view.picker?.manage;
  const dismissible = !!view.picker?.dismissible;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modal || e.key !== 'Escape') return;
      if (manage) profileStore.setManage(false);
      else if (dismissible) profileStore.closePicker();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, manage, dismissible]);

  useEffect(() => {
    if (!modal) document.querySelector<HTMLElement>('.profile-tile')?.focus();
  }, [modal === null, manage]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (p: Profile) => {
    if (manage) return setModal({ kind: 'edit', profile: p });
    if (p.pin) return setModal({ kind: 'pin', profile: p });
    profileStore.enter(p.id);
  };

  return (
    <div className="picker" {...(modal ? {} : { 'data-nav-scope': '' })}>
      <h1 className="picker__title">{manage ? 'Manage profiles' : "Who's watching?"}</h1>
      <ul className="picker__grid">
        {live.map((p) => (
          <li key={p.id}>
            <button type="button" className={`profile-tile ${p.id === view.activeId ? 'is-current' : ''}`} onClick={() => choose(p)}>
              <span className="profile-tile__art">
                <Avatar avatar={p.avatar} color={p.color} size={128} />
                {manage && <span className="profile-tile__edit" aria-hidden="true">✎</span>}
                {p.pin && !manage && <span className="profile-tile__lock" aria-label="Has a PIN">🔒</span>}
              </span>
              <span className="profile-tile__name">{p.name}</span>
              {p.kids && <span className="profile-tile__kids">Kids</span>}
            </button>
          </li>
        ))}
        {manage && live.length < MAX_PROFILES && (
          <li>
            <button type="button" className="profile-tile profile-tile--add" onClick={() => setModal({ kind: 'edit', profile: null })}>
              <span className="profile-tile__art profile-tile__plus" aria-hidden="true">
                +
              </span>
              <span className="profile-tile__name">Add profile</span>
            </button>
          </li>
        )}
      </ul>
      <div className="picker__actions">
        {manage ? (
          <button type="button" className="btn btn--play" onClick={() => profileStore.setManage(false)}>
            Done
          </button>
        ) : (
          <>
            <button type="button" className="btn btn--ghost" onClick={() => (profileStore.guardianRequired() ? setModal({ kind: 'guardian' }) : profileStore.setManage(true))}>
              Manage profiles
            </button>
            {dismissible && (
              <button type="button" className="btn btn--info" onClick={() => profileStore.closePicker()}>
                Back
              </button>
            )}
          </>
        )}
      </div>

      {modal?.kind === 'pin' && (
        <PinPad
          title={`PIN for ${modal.profile.name}`}
          lockedMs={lockLeft(modal.profile.id, { kv: undefined, now: () => Date.now() })}
          onCancel={() => setModal(null)}
          onSubmit={async (pin) => {
            const r = await profileStore.unlock(modal.profile.id, pin);
            if (r.ok) profileStore.enter(modal.profile.id, true);
            return r;
          }}
        />
      )}
      {modal?.kind === 'guardian' && (
        <GuardianPad
          onCancel={() => setModal(null)}
          onOk={() => {
            profileStore.setManage(true);
            setModal(null);
          }}
        />
      )}
      {modal?.kind === 'edit' && <ProfileEditor profile={modal.profile} onClose={() => setModal(null)} />}
    </div>
  );
}
