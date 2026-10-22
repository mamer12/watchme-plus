/** The active profile's avatar in the nav, with Switch profile and Manage profiles. */
import { useEffect, useRef, useState } from 'react';
import { Avatar } from './Avatar';
import { GuardianPad } from './Guardian';
import { capabilities } from './logic';
import { profileStore, useProfiles } from './singleton';

export function ProfileMenu() {
  const view = useProfiles();
  const active = profileStore.active();
  const [open, setOpen] = useState(false);
  const [guard, setGuard] = useState<null | 'switch' | 'manage'>(null);
  const root = useRef<HTMLDivElement>(null);
  const caps = capabilities(active);

  useEffect(() => {
    if (!open) return;
    const off = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', off);
    return () => {
      document.removeEventListener('mousedown', off);
      document.removeEventListener('keydown', off);
    };
  }, [open]);

  if (!active) return null;

  const run = (what: 'switch' | 'manage') => {
    setOpen(false);
    // A Kids profile is left (and management opened) only with an adult's PIN, when any adult has one.
    if (profileStore.guardianRequired() && (active.kids || what === 'manage')) return setGuard(what);
    profileStore.openPicker(what === 'manage');
  };

  return (
    <div className="profile-menu" ref={root}>
      <button type="button" className="profile-menu__btn" aria-label={`Profile: ${active.name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Avatar avatar={active.avatar} color={active.color} size={32} />
      </button>
      {open && (
        <div className="profile-menu__pop" role="menu" aria-label="Profile">
          <p className="profile-menu__name">{active.name}</p>
          <button type="button" role="menuitem" onClick={() => run('switch')}>
            Switch profile
          </button>
          {caps.manageProfiles && view.list.length > 0 && (
            <button type="button" role="menuitem" onClick={() => run('manage')}>
              Manage profiles
            </button>
          )}
        </div>
      )}
      {guard && (
        <GuardianPad
          onCancel={() => setGuard(null)}
          onOk={() => {
            const manage = guard === 'manage';
            setGuard(null);
            profileStore.openPicker(manage);
          }}
        />
      )}
    </div>
  );
}
