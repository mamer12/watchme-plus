/** Connection hints for the active provider's hosts (and the signed file host once known). */
import { getIsp, hostsFor, subscribeIsp } from '../api/endpoints';

const added = new Set<string>();

export function addHint(rel: 'preconnect' | 'dns-prefetch', host: string): void {
  if (typeof document === 'undefined') return;
  const key = `${rel}|${host}`;
  if (added.has(key)) return;
  added.add(key);
  const link = document.createElement('link');
  link.rel = rel;
  link.href = `https://${host}`;
  if (rel === 'preconnect') link.crossOrigin = '';
  document.head.appendChild(link);
}

/** Preconnects to the active provider only, and re-does it when the provider changes. */
export function startProviderHints(): void {
  const apply = () => hostsFor(getIsp()).forEach((h) => addHint('preconnect', h));
  apply();
  subscribeIsp(apply);
}
