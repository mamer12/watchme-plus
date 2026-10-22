import { describe, expect, it } from 'vitest';
import { MAX_CHOICES, MAX_USER_TURNS, parseModelText, sanitizeReply, systemPrompt, validateRequest } from '../../../supabase/functions/spark-tonight/validate';

const user = (text: string) => ({ role: 'user', text });

describe('spark-tonight validation', () => {
  it('TONIGHT-007: caps turns, message sizes and the taste summary; the last message must be the user\'s', () => {
    expect(validateRequest({ messages: [user('hi')], summary: {} }).ok).toBe(true);
    expect(validateRequest(null)).toEqual({ ok: false, reason: 'bad_request' });
    expect(validateRequest({ messages: [], summary: {} }).ok).toBe(false);
    expect(validateRequest({ messages: [{ role: 'system', text: 'x' }] }).ok).toBe(false);
    expect(validateRequest({ messages: [{ role: 'assistant', text: 'q?' }] }).ok).toBe(false);
    const many = Array.from({ length: MAX_USER_TURNS + 1 }, (_, i) => user(`a${i}`));
    expect(validateRequest({ messages: many, summary: {} })).toEqual({ ok: false, reason: 'too_many_turns' });
    expect(validateRequest({ messages: Array(30).fill(user('x')) })).toEqual({ ok: false, reason: 'too_long' });
    expect(validateRequest({ messages: [user('hi')], summary: { big: 'x'.repeat(3000) } })).toEqual({ ok: false, reason: 'summary_too_large' });
    const long = validateRequest({ messages: [user('y'.repeat(5000))], summary: {} });
    expect(long.ok && long.value.messages[0]?.text.length).toBe(400);
  });

  it('TONIGHT-008: rebuilds the model\'s reply: known genres only, caps, no control characters', () => {
    const r = sanitizeReply({
      say: 'Great\u0000 choice!  Here you go',
      choices: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      filters: { type: 'film', genres: ['Comedy', 'cooking', 'sci-fi', 'comedy'], excludeGenres: ['comedy', 'horror'], maxMinutes: 5000, minYear: 2020, maxYear: 2010, lang: 'AR', keywords: ['Cozy', 'x'.repeat(100), '', 'cozy'] },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.say).toBe('Great choice! Here you go');
    expect(r.value.choices).toEqual([]); // filters returned: no more questions
    expect(r.value.filters).toEqual({ type: 'any', genres: ['comedy', 'sci-fi'], excludeGenres: ['horror'], keywords: ['cozy', 'x'.repeat(30)], lang: 'ar' });

    const q = sanitizeReply({ say: 'Who is watching?', choices: ['a', 'b', 'c', 'd', 'e', 'f'], filters: null });
    expect(q.ok && q.value.choices).toHaveLength(MAX_CHOICES);
    expect(q.ok && q.value.filters).toBeNull();
  });

  it('TONIGHT-008: rejects replies that are not usable', () => {
    for (const bad of [null, 'x', [], {}, { say: '' }, { say: 'Fine.', choices: [], filters: null }]) {
      expect(sanitizeReply(bad)).toEqual({ ok: false, reason: 'bad_model_output' });
    }
    expect(parseModelText('not json')).toEqual({ ok: false, reason: 'bad_model_output' });
    expect(parseModelText(undefined).ok).toBe(false);
    const fenced = parseModelText('```json\n{"say":"Time?","choices":["short"],"filters":null}\n```');
    expect(fenced.ok).toBe(true);
    expect(parseModelText('{"say":"Time?","choices":["short"],"filters":{"type":"tv","genres":[],"excludeGenres":[],"keywords":[],"maxMinutes":45,"minYear":2015}}')).toMatchObject({ ok: true, value: { filters: { type: 'tv', maxMinutes: 45, minYear: 2015 } } });
  });

  it('TONIGHT-008: the system prompt forbids naming titles and takes the product name as a parameter', () => {
    const p = systemPrompt('Zed');
    expect(p).toContain('Zed Tonight');
    expect(p).toMatch(/NEVER name/);
    expect(p).not.toMatch(/Cinemana/i);
  });
});
