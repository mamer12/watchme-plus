import type { LibraryState } from '../state/library';

/** The family filter a Kids profile is fixed at (the catalog's `level` parameter). */
export const KIDS_LEVEL = 2;

/** A Kids profile always has the family filter at its level and flagged scenes skipped; same object when already so. */
export function enforceKids(s: LibraryState): LibraryState {
  if (s.settings.level === KIDS_LEVEL && s.settings.familySkips) return s;
  return { ...s, settings: { ...s.settings, level: KIDS_LEVEL, familySkips: true } };
}
