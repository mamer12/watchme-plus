/** The profile list, which profile is on screen, and the "Who's watching?" state. An external store with injected
 * dependencies (storage, clock, crypto, the library) so the rules run in tests as they do in the browser. */
import type { LibraryState } from '../state/library';
import { removeKey, type KV } from '../lib/storage';
import { addProfile, canAdd, deleteProfile, editProfile, guardians, liveProfiles, needsGuardianPin, startupPlan, type EditError, type ProfileInput } from './logic';
import { libraryKey, loadProfiles, saveProfiles } from './persist';
import type { PinCrypto } from './pin';
import { checkPin, type PinResult } from './pinGate';
import { isTombstone, MAIN_ID, type PinRecord, type Profile, type StoredProfile } from './types';

export interface ProfilesView {
  list: StoredProfile[];
  activeId: string;
  /** Show "Who's watching?" on every start (this device). */
  askOnStart: boolean;
  /** The full-screen picker, or null. `manage` is the edit mode. */
  picker: { manage: boolean; /** Whether it can be closed without choosing (it was opened from the menu, not at start). */ dismissible: boolean } | null;
  /** A parent's PIN was entered (or an adult's own) since the last switch: management can open without asking again. */
  guardianOk: boolean;
  /** When the list last changed (ms): what sync compares. */
  updatedAt: number;
}

export interface LibraryHost {
  activeId(): string;
  getState(): LibraryState;
  /** Saves the live library, then makes the profile's the live one. */
  switchLibrary(id: string, kids: boolean): void;
  readLibrary(id: string): LibraryState;
  flush(): void;
}

export interface ProfilesDeps {
  kv?: KV | null;
  now: () => number;
  random?: () => number;
  crypto?: PinCrypto;
  host: LibraryHost;
  /** Wraps a library swap (sync must not read it as an edit). */
  around?: (swap: () => void) => void;
  /** After another profile became the live one. */
  switched?: () => void;
  /** A profile was deleted with "also delete its synced data": its library, to tombstone on the server. */
  purge?: (id: string, lib: LibraryState) => void;
}

type ChangeListener = (list: StoredProfile[], updatedAt: number) => void;

export class ProfilesStore {
  private view: ProfilesView;
  private readonly listeners = new Set<() => void>();
  private readonly changeListeners = new Set<ChangeListener>();

  constructor(private readonly d: ProfilesDeps) {
    const saved = loadProfiles(d.kv, d.now());
    const plan = startupPlan(saved.list, saved.lastId, saved.askOnStart);
    this.view = { list: saved.list, activeId: plan.profileId, askOnStart: saved.askOnStart, picker: plan.picker ? { manage: false, dismissible: false } : null, guardianOk: false, updatedAt: saved.updatedAt };
  }

  // ---- reading ----------------------------------------------------------------------------------

  getView = (): ProfilesView => this.view;
  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  /** The list changed here, not through sync. */
  onLocalChange(cb: ChangeListener): () => void {
    this.changeListeners.add(cb);
    return () => this.changeListeners.delete(cb);
  }

  live = (): Profile[] => liveProfiles(this.view.list);
  active = (): Profile | null => this.live().find((p) => p.id === this.view.activeId) ?? null;
  /** Whether a parent's PIN is needed to open management or leave a Kids profile. */
  guardianRequired = (): boolean => needsGuardianPin(this.view.list) && !this.view.guardianOk;

  /** Every profile's library: the live one as it is now, the others as saved. */
  libraries(): { id: string; state: LibraryState }[] {
    this.d.host.flush();
    return this.live().map((p) => ({ id: p.id, state: p.id === this.view.activeId ? this.d.host.getState() : this.d.host.readLibrary(p.id) }));
  }

  // ---- internals --------------------------------------------------------------------------------

  private set(patch: Partial<ProfilesView>): void {
    this.view = { ...this.view, ...patch };
    saveProfiles({ v: 1, list: this.view.list, lastId: this.view.activeId, askOnStart: this.view.askOnStart, updatedAt: this.view.updatedAt }, this.d.kv);
    this.listeners.forEach((l) => l());
  }

  private around(swap: () => void): void {
    if (this.d.around) this.d.around(swap);
    else swap();
  }

  private commit(list: StoredProfile[]): void {
    const updatedAt = this.d.now();
    this.set({ list, updatedAt });
    this.changeListeners.forEach((l) => l(list, updatedAt));
  }

  private openLibrary(p: Profile): void {
    this.around(() => this.d.host.switchLibrary(p.id, p.kids));
    this.d.switched?.();
  }

  // ---- who is watching --------------------------------------------------------------------------

  /** Makes a profile the live one. The caller has already asked for its PIN if it has one (`verified`). */
  enter(id: string, verified = false): boolean {
    const p = this.live().find((x) => x.id === id);
    if (!p) return false;
    if (id !== this.d.host.activeId() || p.kids !== (this.active()?.kids ?? false)) this.openLibrary(p);
    this.set({ activeId: id, picker: null, guardianOk: verified && !p.kids && !!p.pin });
    return true;
  }

  openPicker(manage = false, dismissible = true): void {
    this.set({ picker: { manage, dismissible } });
  }
  closePicker(): void {
    this.set({ picker: null });
  }
  setManage(manage: boolean): void {
    if (this.view.picker) this.set({ picker: { ...this.view.picker, manage } });
  }
  setAskOnStart(askOnStart: boolean): void {
    this.set({ askOnStart });
  }

  // ---- PIN --------------------------------------------------------------------------------------

  private get gate() {
    return { kv: this.d.kv, now: () => this.d.now(), crypto: this.d.crypto };
  }

  /** The PIN to enter a profile. */
  async unlock(id: string, pin: string): Promise<PinResult> {
    const p = this.live().find((x) => x.id === id);
    if (!p?.pin) return { ok: true };
    return checkPin(pin, [p.pin], id, this.gate);
  }

  /** Any adult's PIN: to open management or to leave a Kids profile. */
  async unlockGuardian(pin: string): Promise<PinResult> {
    const targets = guardians(this.view.list).flatMap((g) => (g.pin ? [g.pin] : []));
    if (!targets.length) return { ok: true };
    const r = await checkPin(pin, targets, 'guardian', this.gate);
    if (r.ok) this.set({ guardianOk: true });
    return r;
  }

  // ---- editing ----------------------------------------------------------------------------------

  canAdd = (): boolean => canAdd(this.view.list);

  add(input: ProfileInput & { pin?: PinRecord | null }): { ok: true; profile: Profile } | { ok: false; error: EditError } {
    const r = addProfile(this.view.list, input, this.d.now(), this.d.random);
    if ('error' in r) return { ok: false, error: r.error };
    const withPin = input.pin ? editProfile(r.list, r.profile.id, { pin: input.pin }) : null;
    this.commit(withPin && 'list' in withPin ? withPin.list : r.list);
    return { ok: true, profile: this.live().find((p) => p.id === r.profile.id) ?? r.profile };
  }

  edit(id: string, patch: Partial<ProfileInput> & { pin?: PinRecord | null }): EditError | null {
    const before = this.live().find((p) => p.id === id);
    const r = editProfile(this.view.list, id, patch);
    if ('error' in r) return r.error;
    this.commit(r.list);
    // The live profile's Kids flag decides what the library enforces: swap it in again.
    const after = this.live().find((p) => p.id === id);
    if (before && after && id === this.view.activeId && before.kids !== after.kids) this.openLibrary(after);
    return null;
  }

  /** Deletes a profile (a tombstone is kept for sync). `purgeSynced` also tombstones its rows on the server. */
  remove(id: string, purgeSynced: boolean): EditError | null {
    this.d.host.flush();
    const lib = purgeSynced ? this.d.host.readLibrary(id) : null;
    const r = deleteProfile(this.view.list, id);
    if ('error' in r) return r.error;
    this.commit(r.list);
    if (id === this.view.activeId) {
      const next = this.live()[0];
      if (next) this.enter(next.id);
    }
    removeKey(libraryKey(id), this.d.kv);
    if (lib) this.d.purge?.(id, lib);
    return null;
  }

  // ---- from sync --------------------------------------------------------------------------------

  /** A newer list from another device replaces this one. */
  apply(list: StoredProfile[], updatedAt: number): void {
    const wasKids = this.active()?.kids;
    const gone = this.view.list.filter((p) => !isTombstone(p) && list.some((q) => q.id === p.id && isTombstone(q)));
    this.set({ list, updatedAt });
    for (const g of gone) removeKey(libraryKey(g.id), this.d.kv);
    const live = liveProfiles(list);
    const cur = live.find((p) => p.id === this.view.activeId);
    if (!cur) {
      const next = live.find((p) => p.id === MAIN_ID) ?? live[0];
      if (next) {
        this.enter(next.id);
        if (live.length > 1) this.openPicker(false, false);
      }
    } else if (cur.kids !== wasKids) {
      this.openLibrary(cur); // the Kids flag changed elsewhere: enforce it here
    }
  }
}
