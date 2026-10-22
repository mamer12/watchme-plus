/** The app's one ProfilesStore, wired to the browser, the library and sync. */
import { useSyncExternalStore } from 'react';
import { invalidateQueries } from '../hooks/useQuery';
import { getState, activeProfileId, flush, readLibrary, switchLibrary } from '../state/store';
import { syncPurge, syncSwitchProfile } from '../sync/bridge';
import { ProfilesStore, type ProfilesView } from './store';

export const profileStore = new ProfilesStore({
  now: () => Date.now(),
  host: { activeId: activeProfileId, getState, switchLibrary, readLibrary, flush },
  around: syncSwitchProfile,
  switched: invalidateQueries,
  purge: syncPurge,
});

export const useProfiles = (): ProfilesView => useSyncExternalStore(profileStore.subscribe, profileStore.getView, profileStore.getView);
