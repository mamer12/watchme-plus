/** The only place server hostnames are written down. */
export type Isp = 'el' | 'albox' | 'other';

/** The EL catalog host. */
const EL_HOST = 'cinemana.shabakaty.com';

export interface Provider {
  id: Isp;
  /** Shown in Settings ("Connected through: ..."). */
  label: string;
  /** Serves `apiPath`. Null until the hostname is known: such a provider is never probed or used. */
  host: string | null;
  /** Artwork servers; the first one is where stored artwork links are re-pointed. */
  imageHosts: string[];
  /** Other hosts the player talks to (video CDN), for connection hints. */
  mediaHosts?: string[];
  /** Path of the catalog API on `host`. */
  apiPath?: string;
  enabled: boolean;
  /** Videos are split into parallel ranges (the service worker add-on). */
  parallelFetch?: boolean;
  /** Slow network: start playback at this quality, with lighter artwork and no mirror media previews. */
  defaultQuality?: '480p';
}

export const DEFAULT_API_PATH = '/api/android/';

/** In priority order: the first one that answers wins. To turn Albox on, edit its line: host, imageHosts, enabled: true. */
export const PROVIDERS: readonly Provider[] = [
  { id: 'el', label: 'EarthLink (EL)', host: EL_HOST, imageHosts: ['cnth2.shabakaty.com'], enabled: true },
  { id: 'albox', label: 'Albox (Supercell, Jazeera)', host: null, imageHosts: [], enabled: false },
  { id: 'other', label: 'Other networks (mirror)', host: 'cee.buzz', imageHosts: ['cnth2.cee.buzz'], mediaHosts: ['cdn.cee.buzz'], enabled: true, parallelFetch: true, defaultQuality: '480p' },
];

/** A provider that can be probed and used: switched on and with a hostname. */
export const isUsable = (p: Provider): boolean => p.enabled && !!p.host;
export const usableProviders = (list: readonly Provider[] = PROVIDERS): Provider[] => list.filter(isUsable);

export const providerById = (id: string | null | undefined): Provider | undefined => PROVIDERS.find((p) => p.id === id);
const provider = (isp: Isp): Provider => providerById(isp) ?? PROVIDERS[0]!;
export const providerLabel = (isp: Isp): string => provider(isp).label;
/** Id of a provider that exists and is usable, else null (unknown or disabled ids fall back to detection). */
export const usableId = (v: unknown): Isp | null => {
  const p = typeof v === 'string' ? providerById(v) : undefined;
  return p && isUsable(p) ? p.id : null;
};

/** The provider whose videos are fetched in parallel ranges (the mirror). */
export const mirror = (): Provider => PROVIDERS.find((p) => p.parallelFetch) ?? PROVIDERS[PROVIDERS.length - 1]!;

export const ISP_KEY = 'wmp:isp';
export const ISP_CHECKED_KEY = 'wmp:isp:checked';
/** First pick when nothing is stored yet (the highest priority provider). */
export const DEFAULT_ISP: Isp = usableProviders()[0]?.id ?? 'el';
/** When no provider answers and none is known. */
export const FALLBACK_ISP: Isp = 'other';

/** localStorage via globalThis, since this file is also loaded by Node build tooling (no DOM types there). */
interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}
const storage = (): Store | undefined => (globalThis as { localStorage?: Store }).localStorage;

let current: Isp | null = null;
const listeners = new Set<() => void>();

/** The stored provider if it is a known, usable one. */
export function readStoredIsp(): Isp | null {
  try {
    return usableId(storage()?.getItem(ISP_KEY));
  } catch {
    return null;
  }
}

export function getIsp(): Isp {
  current ??= readStoredIsp() ?? DEFAULT_ISP;
  return current;
}

/** Sets the active provider and tells subscribers. Callers that cache API data should go through `switchIsp`. */
export function setIsp(isp: Isp, persist = true): void {
  if (!usableId(isp)) return;
  const changed = getIsp() !== isp;
  current = isp;
  if (persist) {
    try {
      storage()?.setItem(ISP_KEY, isp);
    } catch {
      /* storage unavailable: the choice lasts for this session */
    }
  }
  if (changed) listeners.forEach((l) => l());
}

export function subscribeIsp(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** For tests: forget the in-memory choice so the next read goes to storage. */
export function resetIspForTests(): void {
  current = null;
}

const apiHost = (isp: Isp): string => provider(isp).host ?? '';

/** `https://<host>/api/android/` for the current (or given) provider. */
export const apiBase = (isp: Isp = getIsp()): string => `https://${apiHost(isp)}${provider(isp).apiPath ?? DEFAULT_API_PATH}`;

/** The cheap request that detection sends to a provider. */
export const probeUrl = (p: Provider): string => `https://${p.host}${p.apiPath ?? DEFAULT_API_PATH}mainCategories?lang=en`;

const imageHost = (isp: Isp): string => provider(isp).imageHosts[0] ?? '';

/** Prefix for bare image paths. */
export const imageBase = (isp: Isp = getIsp()): string => `https://${imageHost(isp)}/`;

/** Points a stored artwork URL at the current provider's image server (My List and history keep old links). */
export function rehostImage(src: string, isp: Isp = getIsp()): string {
  const target = imageHost(isp);
  if (!target) return src;
  try {
    const u = new URL(src);
    if (!isCatalogImageHost(u.hostname) || u.hostname === target) return src;
    u.hostname = target;
    return u.toString();
  } catch {
    return src;
  }
}

const apiHostnames = (): string[] => usableProviders().map((p) => p.host!);
const imageHostnames = (): string[] => usableProviders().flatMap((p) => p.imageHosts);

/** Every host the given provider uses, for preconnect / dns-prefetch hints. */
export const hostsFor = (isp: Isp): string[] => {
  const p = provider(isp);
  return isUsable(p) ? [p.host!, ...p.imageHosts, ...(p.mediaHosts ?? [])] : [];
};

export const isCatalogApiHost = (hostname: string): boolean => apiHostnames().includes(hostname);
export const isImageHost = (hostname: string): boolean => imageHostnames().includes(hostname);

/** The catalog's artwork servers come in several numbers and domains (cnth2.*, cnth3.*): the family of the known hosts. */
/** Other domains the API has been seen to name for the same artwork servers. */
const IMAGE_ALIAS_DOMAINS = ['shabakaty.cc'];
const imageFamilies = (): string[] => [...imageHostnames().map((h) => h.replace(/^[^.]+\./, '')), ...IMAGE_ALIAS_DOMAINS];
export function isCatalogImageHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (isImageHost(h)) return true;
  const dot = h.indexOf('.');
  return dot > 0 && /^cnth\d*$/.test(h.slice(0, dot)) && imageFamilies().some((f) => h.slice(dot + 1) === f || h.endsWith(`.${f}`));
}

/** Hostnames for build tooling (preconnect links, service worker routes). */
export const API_HOSTNAMES = apiHostnames();
export const IMAGE_HOSTNAMES = imageHostnames();
