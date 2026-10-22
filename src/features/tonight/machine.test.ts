import { describe, expect, it } from 'vitest';
import { MAX_USER_TURNS } from '../../../supabase/functions/spark-tonight/validate';
import { FALLBACK_STEPS, filtersFromAnswers, matchOption } from './fallback';
import { addUser, answerFallback, applyReply, historyForApi, MAX_HISTORY, startChat, toFallback } from './machine';

describe('fallback questions', () => {
  it('TONIGHT-004: maps the fixed answers to the same filters shape as the AI', () => {
    const f = filtersFromAnswers({ company: 'family', kind: 'movie', mood: 'light', length: 'short' });
    expect(f.type).toBe('movie');
    expect(f.genres).toEqual(expect.arrayContaining(['comedy', 'animation', 'family']));
    expect(f.excludeGenres).toEqual(expect.arrayContaining(['horror', 'war']));
    expect(f.maxMinutes).toBe(100);
    expect(f.genres.some((g) => f.excludeGenres.includes(g))).toBe(false);
    expect(filtersFromAnswers({ kind: 'tv', mood: 'thrilling', company: 'friends', length: 'any' })).toMatchObject({ type: 'tv', keywords: ['thrilling'] });
    expect(filtersFromAnswers({}).type).toBe('any');
    // chips and typed text, in either language
    const step = FALLBACK_STEPS[0]!;
    expect(matchOption(step, 'Family')?.id).toBe('family');
    expect(matchOption(step, 'العائلة')?.id).toBe('family');
    expect(matchOption(step, 'nope')).toBeNull();
  });

  it('TONIGHT-004: asks company, kind, mood and length in English and Arabic, then finishes with filters', () => {
    for (const lang of ['en', 'ar'] as const) {
      let s = startChat('fallback', lang);
      expect(s.messages).toHaveLength(1);
      expect(s.choices.length).toBeGreaterThan(1);
      for (const step of FALLBACK_STEPS) s = answerFallback(s, step.options[0]!.label[lang]);
      expect(s.status).toBe('done');
      expect(s.filters).not.toBeNull();
    }
    const s = startChat('fallback', 'en');
    const again = answerFallback(s, 'blue cheese');
    expect(again.status).toBe('asking');
    expect(again.step).toBe(0);
    expect(again.turns).toBe(0);
  });
});

describe('conversation state machine', () => {
  it('TONIGHT-005: ends at the turn cap and trims the history sent to the AI', () => {
    let s = startChat('ai', 'en');
    for (let i = 0; i < MAX_USER_TURNS; i++) {
      s = addUser(s, `answer ${i}`);
      expect(s.status).toBe('thinking');
      s = applyReply(s, { say: `question ${i}?`, choices: ['a', 'b'], filters: null });
    }
    expect(s.status).toBe('done');
    expect(s.filters).toEqual({ type: 'any', genres: [], excludeGenres: [], keywords: [] });
    expect(addUser(s, 'more')).toBe(s);
    expect(historyForApi(s).length).toBeLessThanOrEqual(MAX_HISTORY);
    expect(historyForApi(s).at(-1)?.text).toBeTruthy();
  });

  it('TONIGHT-005: a reply with filters ends the chat; empty input and double sends are ignored', () => {
    let s = startChat('ai', 'en');
    expect(addUser(s, '   ')).toBe(s);
    s = addUser(s, 'family');
    expect(addUser(s, 'again while waiting')).toBe(s);
    const f = { type: 'movie' as const, genres: ['comedy'], excludeGenres: [], keywords: [] };
    s = applyReply(s, { say: 'Here you go', choices: [], filters: f });
    expect(s).toMatchObject({ status: 'done', filters: f, choices: [] });
  });

  it('TONIGHT-006: switches to the fixed questions when the AI fails, from the first question', () => {
    let s = startChat('ai', 'ar');
    s = addUser(s, 'العائلة');
    const fb = toFallback(s);
    expect(fb.mode).toBe('fallback');
    expect(fb.status).toBe('asking');
    expect(fb.step).toBe(0);
    expect(fb.choices.length).toBeGreaterThan(1);
    expect(fb.messages.length).toBeGreaterThan(s.messages.length);
  });
});
