/** Page side of parallel fetching: tells the service worker whether the provider is "Other". */
import { getIsp, subscribeIsp } from '../api/endpoints';
import { PF_FLAG_KEY, PF_MESSAGE, pfWanted, type PfMessage } from './pfState';

const stored = (): string | null => {
  try {
    return localStorage.getItem(PF_FLAG_KEY);
  } catch {
    return null;
  }
};

/** Whether the current provider and flag want parallel fetching (it also unlocks the one step up in adaptive quality). */
export const parallelWanted = (): boolean => pfWanted(getIsp(), stored());

function tell(): void {
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
  const msg: PfMessage = { type: PF_MESSAGE, on: parallelWanted() };
  sw?.controller?.postMessage(msg);
  sw?.ready.then((reg) => reg.active?.postMessage(msg)).catch(() => {});
}

/** Sends the state now, whenever the provider changes, and when a new worker takes over. */
export function startParallelSync(): void {
  tell();
  subscribeIsp(tell);
  navigator.serviceWorker?.addEventListener('controllerchange', tell);
}
