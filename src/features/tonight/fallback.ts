/** The fixed questions used when the AI is unreachable, and their mapping to the same `filters` shape. Pure. */
import type { Bi } from './text';
import { pick } from './text';
import type { Choice, Lang, TonightFilters } from './types';

export interface FallbackOption {
  id: string;
  label: Bi;
}

export interface FallbackStep {
  id: 'company' | 'kind' | 'mood' | 'length';
  question: Bi;
  options: FallbackOption[];
}

export const FALLBACK_STEPS: FallbackStep[] = [
  {
    id: 'company',
    question: { en: 'Who is watching tonight?', ar: 'منو راح يشوف الليلة؟' },
    options: [
      { id: 'alone', label: { en: 'Just me', ar: 'أنا بس' } },
      { id: 'family', label: { en: 'Family', ar: 'العائلة' } },
      { id: 'friends', label: { en: 'Friends', ar: 'الربع' } },
    ],
  },
  {
    id: 'kind',
    question: { en: 'A film or a series?', ar: 'فيلم لو مسلسل؟' },
    options: [
      { id: 'movie', label: { en: 'A film', ar: 'فيلم' } },
      { id: 'tv', label: { en: 'A series', ar: 'مسلسل' } },
      { id: 'any', label: { en: 'Either', ar: 'مو مهم' } },
    ],
  },
  {
    id: 'mood',
    question: { en: 'What mood are you in?', ar: 'شنو مزاجك؟' },
    options: [
      { id: 'light', label: { en: 'Light and fun', ar: 'خفيف ومرح' } },
      { id: 'intense', label: { en: 'Intense', ar: 'قوي ومشحون' } },
      { id: 'thoughtful', label: { en: 'Thoughtful', ar: 'عميق' } },
      { id: 'thrilling', label: { en: 'Thrilling', ar: 'تشويق' } },
    ],
  },
  {
    id: 'length',
    question: { en: 'How much time do you have?', ar: 'شكد وقتك؟' },
    options: [
      { id: 'short', label: { en: 'Short (under 100 min)', ar: 'قصير (أقل من 100 دقيقة)' } },
      { id: 'long', label: { en: 'I have time', ar: 'عندي وقت' } },
      { id: 'any', label: { en: 'Any length', ar: 'مو مهم' } },
    ],
  },
];

export type Answers = Partial<Record<FallbackStep['id'], string>>;

export const SHORT_MINUTES = 100;

const MOOD_GENRES: Record<string, string[]> = {
  light: ['comedy', 'animation', 'romance'],
  intense: ['action', 'crime', 'thriller'],
  thoughtful: ['drama', 'history', 'documentary'],
  thrilling: ['thriller', 'mystery', 'action'],
};

const COMPANY: Record<string, { add: string[]; exclude: string[] }> = {
  alone: { add: [], exclude: [] },
  family: { add: ['family'], exclude: ['horror', 'war', 'crime'] },
  friends: { add: ['comedy', 'adventure'], exclude: [] },
};

/** Maps the answers to the filters the AI returns, so one resolver serves both. */
export function filtersFromAnswers(a: Answers): TonightFilters {
  const company = COMPANY[a.company ?? ''] ?? COMPANY.alone!;
  const exclude = company.exclude;
  const genres = [...new Set([...(MOOD_GENRES[a.mood ?? ''] ?? []), ...company.add])].filter((g) => !exclude.includes(g));
  const type = a.kind === 'movie' || a.kind === 'tv' ? a.kind : 'any';
  const filters: TonightFilters = { type, genres, excludeGenres: [...exclude], keywords: a.mood ? [a.mood] : [] };
  if (a.length === 'short') filters.maxMinutes = SHORT_MINUTES;
  return filters;
}

export const stepAt = (i: number): FallbackStep | null => FALLBACK_STEPS[i] ?? null;

export const choicesFor = (step: FallbackStep, lang: Lang): Choice[] => step.options.map((o) => ({ label: pick(o.label, lang), value: o.id }));

/** Finds the option a tapped chip or typed text means (either language, case-insensitive). */
export function matchOption(step: FallbackStep, input: string): FallbackOption | null {
  const t = input.trim().toLowerCase();
  if (!t) return null;
  return step.options.find((o) => o.id === t || o.label.en.toLowerCase() === t || o.label.ar === t) ?? null;
}
