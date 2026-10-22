/** The fixed questions used when the AI is unreachable, and their mapping to the same `filters` shape. Pure. */
import type { Bi } from './text';
import { pick } from './text';
import type { Choice, Lang, TonightFilters } from './types';

export interface FallbackOption {
  id: string;
  label: Bi;
}

export type StepId = 'mood' | 'company' | 'kind' | 'mind' | 'length' | 'origin' | 'era';

export interface FallbackStep {
  id: StepId;
  question: Bi;
  options: FallbackOption[];
  /** Free text is welcome (the answer is kept and read for genres and keywords). */
  freeText?: boolean;
}

/** The id every step accepts: the question is dropped and nothing is assumed. */
export const SKIP = 'skip';
export const SKIP_LABEL: Bi = { en: 'Skip', ar: 'تخطي' };

const o = (id: string, en: string, ar: string): FallbackOption => ({ id, label: { en, ar } });

export const FALLBACK_STEPS: FallbackStep[] = [
  {
    id: 'mood',
    question: { en: 'How are you feeling right now, or what is on your mind?', ar: 'شلون حاس هسه، أو شنو ببالك؟' },
    options: [
      o('happy', 'Happy', 'مبسوط'),
      o('relaxed', 'Relaxed', 'رايق'),
      o('sad', 'Sad', 'حزين'),
      o('tense', 'Tense', 'متوتر'),
      o('excited', 'Excited', 'متحمس'),
      o('curious', 'Curious', 'فضولي'),
      o('romantic', 'Romantic', 'رومانسي'),
      o('nostalgic', 'Nostalgic', 'مشتاق للأيام الماضية'),
    ],
  },
  {
    id: 'company',
    question: { en: 'Who is watching with you?', ar: 'منو يشوف وياك؟' },
    options: [o('alone', 'Just me', 'أنا بس'), o('partner', 'Me and my partner', 'أنا وشريكي'), o('family', 'Family with kids', 'العائلة مع الأطفال'), o('friends', 'Friends', 'الربع')],
  },
  {
    id: 'kind',
    question: { en: 'A film or a series?', ar: 'فيلم لو مسلسل؟' },
    options: [o('movie', 'A film', 'فيلم'), o('tv', 'A series', 'مسلسل'), o('any', 'Either', 'مو مهم')],
  },
  {
    id: 'mind',
    question: { en: 'Anything in mind? Pick a genre or tell me in your own words.', ar: 'ببالك شي؟ اختار نوع أو كتبلي بكلماتك.' },
    freeText: true,
    options: [
      o('comedy', 'Comedy', 'كوميدي'),
      o('action', 'Action', 'أكشن'),
      o('drama', 'Drama', 'دراما'),
      o('thriller', 'Thriller', 'تشويق'),
      o('romance', 'Romance', 'رومانسي'),
      o('sci-fi', 'Sci-fi', 'خيال علمي'),
      o('documentary', 'Documentary', 'وثائقي'),
      o('horror', 'Horror', 'رعب'),
    ],
  },
  {
    id: 'length',
    question: { en: 'How much time do you have?', ar: 'شكد وقتك؟' },
    options: [o('short', 'Short (under 100 min)', 'قصير (أقل من 100 دقيقة)'), o('long', 'I have time', 'عندي وقت'), o('any', 'Any length', 'مو مهم')],
  },
  {
    id: 'origin',
    question: { en: 'Any language or origin you prefer?', ar: 'تفضل لغة أو بلد معين؟' },
    options: [o('ar', 'Arabic', 'عربي'), o('en', 'English', 'إنكليزي'), o('tr', 'Turkish', 'تركي'), o('ko', 'Korean', 'كوري'), o('hi', 'Hindi', 'هندي'), o('any', 'Any', 'مو مهم')],
  },
  {
    id: 'era',
    question: { en: 'New, or older?', ar: 'جديد لو قديم؟' },
    options: [o('new', 'Recent (2018 on)', 'جديد (من 2018)'), o('mid', '2000 to 2017', 'من 2000 إلى 2017'), o('classic', 'Classics (before 2000)', 'كلاسيكي (قبل 2000)'), o('any', 'Any', 'مو مهم')],
  },
];

export type Answers = Partial<Record<StepId, string>>;

export const SHORT_MINUTES = 100;
const FREE = 'free:';
const MAX_FREE = 60;

/** What each mood means as genres, and what to keep out when the mood is gentle. */
const MOOD: Record<string, { genres: string[]; exclude: string[] }> = {
  happy: { genres: ['comedy', 'animation', 'music'], exclude: ['horror', 'war'] },
  relaxed: { genres: ['comedy', 'romance', 'documentary'], exclude: ['horror', 'war', 'thriller'] },
  sad: { genres: ['drama', 'romance'], exclude: ['horror'] },
  tense: { genres: ['thriller', 'crime', 'mystery'], exclude: [] },
  excited: { genres: ['action', 'adventure', 'sci-fi'], exclude: [] },
  curious: { genres: ['documentary', 'mystery', 'sci-fi', 'history'], exclude: [] },
  romantic: { genres: ['romance', 'drama', 'comedy'], exclude: ['horror', 'war'] },
  nostalgic: { genres: ['family', 'adventure', 'comedy'], exclude: [] },
};

const COMPANY: Record<string, { add: string[]; exclude: string[] }> = {
  alone: { add: [], exclude: [] },
  partner: { add: ['romance'], exclude: [] },
  family: { add: ['family'], exclude: ['horror', 'war', 'crime'] },
  friends: { add: ['comedy', 'adventure'], exclude: [] },
};

const ERA: Record<string, { minYear?: number; maxYear?: number }> = {
  new: { minYear: 2018 },
  mid: { minYear: 2000, maxYear: 2017 },
  classic: { maxYear: 1999 },
};

const uniq = (a: string[]): string[] => [...new Set(a)];
const isFree = (v: string | undefined): v is string => !!v && v.startsWith(FREE);

/** The genres a free-text answer names (either language), in the order they are written. */
export function genresInText(text: string): string[] {
  const t = text.toLowerCase();
  const mind = FALLBACK_STEPS.find((s) => s.id === 'mind')!;
  return mind.options.filter((x) => t.includes(x.label.en.toLowerCase()) || t.includes(x.id) || t.includes(x.label.ar)).map((x) => x.id);
}

/** Maps the answers to the filters the AI returns, so one resolver serves both. Skipped questions assume nothing. */
export function filtersFromAnswers(a: Answers): TonightFilters {
  const mood = MOOD[a.mood ?? ''];
  const company = COMPANY[a.company ?? ''] ?? COMPANY.alone!;
  const free = isFree(a.mind) ? a.mind.slice(FREE.length) : '';
  const mindGenres = isFree(a.mind) ? genresInText(free) : a.mind && a.mind !== SKIP ? [a.mind] : [];
  const exclude = uniq([...company.exclude, ...(mood?.exclude ?? [])]).filter((g) => !mindGenres.includes(g));
  const wanted = uniq([...mindGenres, ...(mood?.genres ?? []), ...company.add]);
  const genres = wanted.filter((g) => !exclude.includes(g)).slice(0, 6);
  const type = a.kind === 'movie' || a.kind === 'tv' ? a.kind : 'any';
  const words = free.toLowerCase().split(/[^\p{L}\p{N}-]+/u).filter((w) => w.length > 2);
  const keywords = uniq([...(a.mood && mood ? [a.mood] : []), ...words]).slice(0, 5);
  const filters: TonightFilters = { type, genres, excludeGenres: exclude.filter((g) => !genres.includes(g)), keywords };
  if (a.length === 'short') filters.maxMinutes = SHORT_MINUTES;
  if (/^[a-z]{2}$/.test(a.origin ?? '')) filters.lang = a.origin;
  const era = ERA[a.era ?? ''] ?? (a.mood === 'nostalgic' ? { maxYear: 2005 } : undefined);
  if (era?.minYear) filters.minYear = era.minYear;
  if (era?.maxYear) filters.maxYear = era.maxYear;
  return filters;
}

/** The next question to ask, from `from` on: never one already answered or skipped. Pure. */
export function nextStepIndex(answers: Answers, from = 0): number {
  for (let i = Math.max(0, from); i < FALLBACK_STEPS.length; i++) if (answers[FALLBACK_STEPS[i]!.id] === undefined) return i;
  return FALLBACK_STEPS.length;
}

export const stepAt = (i: number): FallbackStep | null => FALLBACK_STEPS[i] ?? null;

/** The step's chips; fixed-question mode adds Skip at the end. */
export const choicesFor = (step: FallbackStep, lang: Lang, withSkip = true): Choice[] => [
  ...step.options.map((x) => ({ label: pick(x.label, lang), value: x.id })),
  ...(withSkip ? [{ label: pick(SKIP_LABEL, lang), value: SKIP }] : []),
];

/**
 * What a tapped chip or typed text means (either language, case-insensitive): an option, Skip, or, where free text is
 * welcome, the text itself (id `free:<text>`).
 */
export function matchOption(step: FallbackStep, input: string): FallbackOption | null {
  const t = input.trim().toLowerCase();
  if (!t) return null;
  if (t === SKIP || t === SKIP_LABEL.en.toLowerCase() || t === SKIP_LABEL.ar) return { id: SKIP, label: SKIP_LABEL };
  const hit = step.options.find((x) => x.id === t || x.label.en.toLowerCase() === t || x.label.ar === t);
  if (hit) return hit;
  return step.freeText ? { id: FREE + input.trim().slice(0, MAX_FREE), label: { en: input.trim(), ar: input.trim() } } : null;
}
