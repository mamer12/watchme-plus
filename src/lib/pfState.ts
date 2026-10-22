/** The page <-> service worker contract for parallel fetching. Shared by both sides; no globals touched at import. */
import { providerById } from '../api/endpoints';

export const PF_FLAG_KEY = 'wmp:pf';
export const PF_MESSAGE = 'wmp:pf';
export const PF_CACHE = 'wmp-pf-state';
export const PF_STATE_URL = '/__wmp_pf_state';

export interface PfMessage {
  type: typeof PF_MESSAGE;
  /** True only when the provider is "Other" and the flag isn't switched off. */
  on: boolean;
}

/** `wmp:pf` is 'on' unless the person (or a support session) set it to 'off'; the provider decides the rest. */
export const pfAllowed = (stored: string | null | undefined): boolean => stored !== 'off';

/** Parallel fetching runs only for the mirror, and only while the flag allows it. */
export const pfWanted = (isp: string, stored: string | null | undefined): boolean => providerById(isp)?.parallelFetch === true && pfAllowed(stored);

export const isPfMessage = (d: unknown): d is PfMessage =>
  !!d && typeof d === 'object' && (d as PfMessage).type === PF_MESSAGE && typeof (d as PfMessage).on === 'boolean';

/** Worker -> page: a finished video response, for the quality controller's throughput (a floor: the player may read slowly). */
export const PF_STAT_MESSAGE = 'wmp:pf-stat';
export interface PfStat {
  type: typeof PF_STAT_MESSAGE;
  bytes: number;
  ms: number;
}
export const isPfStat = (d: unknown): d is PfStat =>
  !!d && typeof d === 'object' && (d as PfStat).type === PF_STAT_MESSAGE && typeof (d as PfStat).bytes === 'number' && typeof (d as PfStat).ms === 'number';
