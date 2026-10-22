import { describe, expect, it } from 'vitest';
import { MAX_USER_TURNS } from '../../../supabase/functions/spark-tonight/validate';
import { choicesFor, FALLBACK_STEPS, filtersFromAnswers, matchOption, nextStepIndex } from './fallback';
import { addUser, answerFallback, applyReply, canRefine, historyForApi, reopen, MAX_HISTORY, startChat, toFallback } from './machine';

describe('fallback questions', () => {
  it('TONIGHT-004: maps mood, company, kind, mind, length, origin and era to the same filters shape as the AI', () => {
    const f = filtersFromAnswers({ mood: 'happy', company: 'family', kind: 'movie', length: 'short', origin: 'en', era: 'new' });
    expect(f).toMatchObject({ type: 'movie', maxMinutes: 100, lang: 'en', minYear: 2018 });
    expect(f.genres).toEqual(expect.arrayContaining(['comedy', 'animation', 'family']));
    expect(f.excludeGenres).toEqual(expect.arrayContaining(['horror', 'war']));
    expect(f.genres.some((g) => f.excludeGenres.includes(g))).toBe(false);
    expect(filtersFromAnswers({ mood: 'tense', kind: 'tv' })).toMatchObject({ type: 'tv', keywords: ['tense'] });
    expect(filtersFromAnswers({ mood: 'tense' }).genres).toEqual(expect.arrayContaining(['thriller', 'mystery']));
    expect(filtersFromAnswers({ mood: 'nostalgic' }).maxYear).toBe(2005);
    expect(filtersFromAnswers({ mood: 'nostalgic', era: 'new' })).toMatchObject({ minYear: 2018 });
    expect(filtersFromAnswers({ era: 'mid' })).toMatchObject({ minYear: 2000, maxYear: 2017 });
    expect(filtersFromAnswers({ mind: 'horror', mood: 'happy' }).genres[0]).toBe('horror');
    expect(filtersFromAnswers({ mind: 'free:something dark about space' }).genres).toEqual([]);
    expect(filtersFromAnswers({ mind: 'free:a romance in Paris' }).genres[0]).toBe('romance');
    expect(filtersFromAnswers({ mind: 'free:a romance in Paris' }).keywords).toContain('paris');
    expect(filtersFromAnswers({ mood: 'sad', mind: 'comedy' }).genres.slice(0, 2)).toEqual(['comedy', 'drama']);
    expect(filtersFromAnswers({ mood: 'skip', company: 'skip', kind: 'skip', mind: 'skip', length: 'skip', origin: 'skip', era: 'skip' })).toEqual({ type: 'any', genres: [], excludeGenres: [], keywords: [] });
    expect(filtersFromAnswers({}).type).toBe('any');
  });

  it('TONIGHT-004: matches chips and typed text in either language; Skip is always accepted; free text only where welcome', () => {
    const mood = FALLBACK_STEPS[0]!;
    expect(matchOption(mood, 'Happy')?.id).toBe('happy');
    expect(matchOption(mood, 'مبسوط')?.id).toBe('happy');
    expect(matchOption(mood, 'Skip')?.id).toBe('skip');
    expect(matchOption(mood, 'تخطي')?.id).toBe('skip');
    expect(matchOption(mood, 'nope')).toBeNull();
    const mind = FALLBACK_STEPS.find((x) => x.id === 'mind')!;
    expect(matchOption(mind, 'something dark in space')?.id).toBe('free:something dark in space');
    expect(matchOption(mind, '')).toBeNull();
  });

  it('TONIGHT-019: question order is pure, never repeats an answered or skipped question and has 7 steps', () => {
    expect(FALLBACK_STEPS.map((x) => x.id)).toEqual(['mood', 'company', 'kind', 'mind', 'length', 'origin', 'era']);
    expect(nextStepIndex({})).toBe(0);
    expect(nextStepIndex({ mood: 'happy' }, 1)).toBe(1);
    expect(nextStepIndex({ mood: 'happy', company: 'skip' }, 1)).toBe(2);
    expect(nextStepIndex({ kind: 'movie' }, 2)).toBe(3);
    expect(nextStepIndex({ mood: 'skip', company: 'skip', kind: 'skip', mind: 'skip', length: 'skip', origin: 'skip', era: 'skip' })).toBe(7);
    // answered later steps are jumped over
    expect(nextStepIndex({ length: 'short' }, 4)).toBe(5);
    expect(choicesFor(FALLBACK_STEPS[0]!, 'en').at(-1)).toEqual({ label: 'Skip', value: 'skip' });
    expect(choicesFor(FALLBACK_STEPS[0]!, 'en', false).some((c) => c.value === 'skip')).toBe(false);
  });

  it('TONIGHT-019: the chat asks all 7 questions in English and Arabic, each skippable, then finishes with filters; no talk of tonight', () => {
    for (const lang of ['en', 'ar'] as const) {
      let s = startChat('fallback', lang);
      expect(s.messages).toHaveLength(1);
      expect(s.choices.at(-1)?.value).toBe('skip');
      const asked = [s.messages[0]!.text];
      for (let i = 0; i < FALLBACK_STEPS.length; i++) {
        s = answerFallback(s, i % 2 ? 'skip' : FALLBACK_STEPS[i]!.options[0]!.label[lang]);
        if (s.status === 'asking') asked.push(s.messages.at(-1)!.text);
      }
      expect(s.status).toBe('done');
      expect(s.filters).not.toBeNull();
      expect(new Set(asked).size).toBe(7);
      expect(JSON.stringify(s.messages)).not.toMatch(/tonight|الليلة|weekend/i);
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

  it('TONIGHT-020: after filters the AI chat can reopen for refinements until the turn cap', () => {
    let s = startChat('ai', 'en');
    s = addUser(s, 'happy');
    s = applyReply(s, { say: 'Here is what fits', choices: [], filters: { type: 'any', genres: ['comedy'], excludeGenres: [], keywords: [] } });
    expect(canRefine(s)).toBe(true);
    const r = reopen(s);
    expect(r).toMatchObject({ status: 'asking', filters: null });
    expect(canRefine(startChat('fallback', 'en'))).toBe(false);
    expect(canRefine({ ...s, turns: MAX_USER_TURNS })).toBe(false);
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
