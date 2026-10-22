/** The real thing: wires the engine to the browser, the library store and the backend, and exposes the account actions
 * the Settings page needs. This is the lazily loaded chunk; nothing here runs unless sync is configured and used. */
import { sanitizeList, liveProfiles } from '../profiles/logic';
import { profileStore } from '../profiles/singleton';
import { discardPendingSave, getState, subscribe, update } from '../state/store';
import { AccountService, libraryHasData, wipeLocalData } from './accounts';
import { purgeItems } from './mapping';
import { cleanDeviceName, deviceNameFromUA } from './codes';
import { SyncClient } from './client';
import { readSyncConfig } from './config';
import { registerBridge } from './bridge';
import { SyncEngine, type EnvLike } from './engine';
import { connectRealtime, realtimeSupported } from './realtime';
import { getSyncStatus, setSyncStatus, subscribeSyncStatus } from './status';
import { SyncStorage } from './syncStorage';
import { SyncHttpError } from './types';

export interface DeviceRow {
  device_name: string | null;
  joined_at: string;
  is_me: boolean;
}

export type JoinResult = { ok: true } | { ok: false; error: 'wrong' | 'too_many_attempts' | 'network' | 'error' };

function browserEnv(): EnvLike {
  return {
    isVisible: () => document.visibilityState === 'visible',
    isOnline: () => navigator.onLine,
    onWake(cb) {
      const vis = () => document.visibilityState === 'visible' && cb();
      window.addEventListener('online', cb);
      document.addEventListener('visibilitychange', vis);
      return () => {
        window.removeEventListener('online', cb);
        document.removeEventListener('visibilitychange', vis);
      };
    },
    onLeave(cb) {
      const hide = () => document.visibilityState === 'hidden' && cb();
      window.addEventListener('pagehide', cb);
      document.addEventListener('visibilitychange', hide);
      return () => {
        window.removeEventListener('pagehide', cb);
        document.removeEventListener('visibilitychange', hide);
      };
    },
  };
}

export class SyncService {
  readonly storage = new SyncStorage();
  readonly client: SyncClient;
  readonly engine: SyncEngine;
  readonly accounts: AccountService;

  constructor() {
    const config = readSyncConfig();
    if (!config) throw new Error('sync is not configured');
    this.client = new SyncClient({
      config,
      fetch: (...a) => fetch(...a),
      now: () => Date.now(),
      loadSession: () => this.storage.get().session,
      saveSession: (session) => this.storage.set((s) => ({ ...s, session })),
      isAccount: () => !!this.storage.get().email,
    });
    this.engine = new SyncEngine({
      api: this.client,
      storage: this.storage,
      store: { getState, update, subscribe },
      profiles: {
        activeId: () => profileStore.getView().activeId,
        snapshot: () => ({ list: profileStore.getView().list, updatedAt: profileStore.getView().updatedAt }),
        apply: (list, at) => profileStore.apply(list, at),
        onLocalChange: (cb) => profileStore.onLocalChange(cb),
        libraries: () => profileStore.libraries(),
      },
      env: browserEnv(),
      now: () => Date.now(),
      realtime: realtimeSupported()
        ? (spaceId, onRow) =>
            connectRealtime(
              { url: config.url, anonKey: config.anonKey, getToken: (min) => this.client.accessToken({ minValidityMs: min }).catch(() => null) },
              spaceId,
              (c) => c.type !== 'DELETE' && onRow(c.table, c.record as never),
            )
        : undefined,
    });
    this.accounts = new AccountService({
      api: this.client,
      storage: this.storage,
      now: () => Date.now(),
      deviceName: () => this.defaultDeviceName(),
      stopEngine: () => this.engine.stop(),
      finalSync: () => Promise.race([this.engine.cycle(), new Promise<void>((r) => setTimeout(r, 4000))]),
      link: (id, name, opts) => this.link(id, name, opts),
      localProfiles: () => profileStore.getView().list,
      hasLocalData: () => liveProfiles(profileStore.getView().list).length > 1 || profileStore.libraries().some((l) => libraryHasData(l.state)),
      applyProfiles: (list, at) => profileStore.apply(list, at),
      fetchRemoteProfiles: async (spaceId) => {
        const rows = await this.client.pull('settings', spaceId, null, 1000);
        const r = rows.find((x) => x.key === 'profiles' && !x.deleted);
        const list = r ? sanitizeList(r.value) : [];
        return liveProfiles(list).length ? list : null;
      },
      wipeLocal: () => {
        discardPendingSave();
        wipeLocalData(localStorage);
      },
    });
    registerBridge({
      flush: (o) => this.engine.flush(o),
      playing: (id) => this.engine.setPlaying(id),
      stop: () => this.engine.stop(),
      switchProfile: (swap) => this.engine.switchProfile(swap),
      purge: (id, lib) => this.engine.queue(purgeItems(lib, { id }, Date.now())),
    });
  }

  defaultDeviceName(): string {
    return deviceNameFromUA(navigator.userAgent, { touchPoints: navigator.maxTouchPoints });
  }

  get linked(): boolean {
    return !!this.storage.get().spaceId;
  }

  /** Resume syncing when this browser is already linked (app start). */
  resume(): void {
    const st = this.storage.get();
    if (st.spaceId && st.session) {
      this.engine.start();
      if (st.pickAfterSync) this.watchSignIn();
    }
    else if (st.spaceId) setSyncStatus({ linked: true, phase: 'error', deviceName: st.deviceName });
  }

  private link(spaceId: string, deviceName: string, opts?: { profilesAt?: number }): void {
    this.storage.set((s) => ({ ...s, spaceId, deviceName }));
    this.engine.beginLink(opts);
    setSyncStatus({ email: this.storage.get().email ?? null });
    if (this.storage.get().pickAfterSync) this.watchSignIn();
  }

  /** After signing in: show "Getting your profiles…" until the first sync lands, then ask who is watching. */
  private watchSignIn(): void {
    setSyncStatus({ gettingProfiles: true, lastSyncAt: null });
    let done = false;
    let off = () => {};
    const finish = () => {
      if (done) return;
      done = true;
      off();
      clearTimeout(timer);
      this.storage.set((s) => ({ ...s, pickAfterSync: false }));
      setSyncStatus({ gettingProfiles: false });
      if (liveProfiles(profileStore.getView().list).length > 1) profileStore.openPicker(false, false);
    };
    const timer = setTimeout(finish, 20_000);
    off = subscribeSyncStatus(() => {
      const s = getSyncStatus();
      if (s.lastSyncAt !== null) finish();
    });
  }

  /** Creates this person's private space and starts syncing. */
  async startSpace(rawName: string): Promise<JoinResult> {
    const name = cleanDeviceName(rawName) || this.defaultDeviceName();
    try {
      const id = await this.client.rpc<string>('create_space', { device_name: name }, true);
      this.link(id, name);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof SyncHttpError && e.status === 0 ? 'network' : 'error' };
    }
  }

  async join(code: string, rawName: string): Promise<JoinResult> {
    const name = cleanDeviceName(rawName) || this.defaultDeviceName();
    try {
      const id = await this.client.rpc<string | null>('redeem_pairing_code', { code, device_name: name }, true);
      if (!id) return { ok: false, error: 'wrong' };
      this.link(id, name);
      return { ok: true };
    } catch (e) {
      if (e instanceof SyncHttpError) {
        if (e.message.includes('too_many_attempts')) return { ok: false, error: 'too_many_attempts' };
        if (e.status === 0) return { ok: false, error: 'network' };
      }
      return { ok: false, error: 'error' };
    }
  }

  newPairingCode(): Promise<string> {
    return this.client.rpc<string>('create_pairing_code');
  }

  listDevices(): Promise<DeviceRow[]> {
    return this.client.rpc<DeviceRow[]>('list_devices');
  }

  /** Leaves the space and forgets the sync state here; this device's library stays as it is. */
  async disconnect(): Promise<void> {
    this.engine.stop();
    try {
      await this.client.rpc('leave_space');
    } catch {
      /* offline: the server forgets us when the space is cleaned up; local state is cleared either way */
    }
    this.storage.clear();
    setSyncStatus({ linked: false, phase: 'off', lastSyncAt: null, pending: 0, email: null, gettingProfiles: false, toast: null });
  }

  /** Deletes every synced row on the server (other devices keep their own copies). */
  async deleteServerData(): Promise<void> {
    await this.client.rpc('delete_space_data');
    this.storage.set((s) => ({ ...s, outbox: [], cursors: {} }));
    setSyncStatus({ pending: 0 });
  }

  syncNow(): void {
    void this.engine.cycle();
  }
}

let service: SyncService | null = null;
export const getSyncService = (): SyncService => (service ??= new SyncService());
