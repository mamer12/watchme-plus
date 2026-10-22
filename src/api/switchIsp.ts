/** Changing provider: remember it, drop everything cached from the old server, and let queries reload. */
import { invalidateQueries } from '../hooks/useQuery';
import { getIsp, setIsp, type Isp } from './endpoints';
import { reportCatalogOk } from './health';
import { clearApiCache } from './http';

/** `persist: false` keeps the choice for this session only (a fallback guess that detection has not confirmed). */
export function switchIsp(isp: Isp, persist = true): void {
  if (getIsp() === isp) {
    if (persist) setIsp(isp);
    return;
  }
  setIsp(isp, persist);
  clearApiCache();
  invalidateQueries();
  reportCatalogOk();
}
