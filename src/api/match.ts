/** Matching TMDB titles (name + year) to the catalog titles. Pure. */
import type { Title } from './types';

export function normalizeName(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export interface Candidate {
  name: string;
  originalName?: string;
  year: number | null;
}

export function yearsClose(a: number | null, b: number | null, tolerance = 1): boolean {
  if (a === null || b === null) return true;
  return Math.abs(a - b) <= tolerance;
}

/** Best the catalog title for a TMDB candidate: same normalized name, year within ±1. */
export function findMatch(candidate: Candidate, titles: Title[]): Title | null {
  const names = new Set([normalizeName(candidate.name), normalizeName(candidate.originalName ?? '')].filter(Boolean));
  if (!names.size) return null;
  let best: Title | null = null;
  let bestScore = -1;
  for (const t of titles) {
    const tn = [normalizeName(t.enTitle), normalizeName(t.arTitle)];
    if (!tn.some((n) => names.has(n))) continue;
    if (!yearsClose(candidate.year, t.year)) continue;
    const score = candidate.year !== null && t.year === candidate.year ? 2 : 1;
    if (score > bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}

export function yearOf(date: unknown): number | null {
  if (typeof date !== 'string') return null;
  const y = Number(date.slice(0, 4));
  return Number.isInteger(y) && y > 1800 ? y : null;
}
