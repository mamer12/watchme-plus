import { useSyncExternalStore } from 'react';
import { getIsp, subscribeIsp, type Isp } from '../api/endpoints';

export const useIsp = (): Isp => useSyncExternalStore(subscribeIsp, getIsp, getIsp);
