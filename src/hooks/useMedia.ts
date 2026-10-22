import { useEffect, useState } from 'react';

export function useMedia(query: string): boolean {
  const get = () => typeof window !== 'undefined' && window.matchMedia(query).matches;
  const [match, setMatch] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

export const useIsDesktop = () => useMedia('(min-width: 800px)');
/** A real mouse: hover cards and previews only make sense there. */
export const useCanHover = () => useMedia('(hover: hover) and (pointer: fine)');
export const useReducedMotion = () => useMedia('(prefers-reduced-motion: reduce)');

/** Data saver or a slow connection. */
export function saveData(): boolean {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !!c && (c.saveData === true || /(^|-)2g$/.test(c.effectiveType ?? ''));
}
