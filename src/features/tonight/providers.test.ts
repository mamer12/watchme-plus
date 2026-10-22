import { describe, expect, it } from 'vitest';
import { extractGeminiText, extractOpenRouterText, openRouterBody, providerOrder, reasonForStatus, toChatMessages } from '../../../supabase/functions/spark-tonight/providers';
import { parseModelText } from '../../../supabase/functions/spark-tonight/validate';

const json = '{"say":"Who is watching?","choices":["Alone","Family"],"filters":null}';

describe('spark-tonight providers', () => {
  it('TONIGHT-016: orders Gemini then OpenRouter, only those with a key, and is empty with none', () => {
    expect(providerOrder({ gemini: 'g', openrouter: 'o' })).toEqual(['gemini', 'openrouter']);
    expect(providerOrder({ gemini: 'g' })).toEqual(['gemini']);
    expect(providerOrder({ gemini: ' ', openrouter: 'o' })).toEqual(['openrouter']);
    expect(providerOrder({})).toEqual([]);
    expect(reasonForStatus(429)).toBe('model_busy');
    expect(reasonForStatus(503)).toBe('model_error');
  });

  it('TONIGHT-017: extracts the JSON text from each provider shape and sanitizes both the same way', () => {
    const g = extractGeminiText({ candidates: [{ content: { parts: [{ text: json }] } }] });
    const o = extractOpenRouterText({ choices: [{ message: { content: json } }] });
    const parts = extractOpenRouterText({ choices: [{ message: { content: [{ type: 'text', text: json }] } }] });
    expect(g).toBe(json);
    expect(o).toBe(json);
    expect(parts).toBe(json);
    expect(parseModelText(o)).toEqual(parseModelText(g));
    expect(parseModelText(`\`\`\`json\n${json}\n\`\`\``).ok).toBe(true);
    for (const bad of [null, {}, { candidates: [] }, { choices: [] }, { choices: [{ message: { content: '  ' } }] }]) {
      expect(extractGeminiText(bad) ?? extractOpenRouterText(bad)).toBeNull();
    }
    expect(parseModelText('not json')).toEqual({ ok: false, reason: 'bad_model_output' });
  });

  it('TONIGHT-017: builds an OpenRouter JSON-mode request with the system prompt and alternating history', () => {
    expect(toChatMessages([{ role: 'assistant', text: 'q' }, { role: 'user', text: 'a' }, { role: 'user', text: 'b' }]))
      .toEqual([{ role: 'user', content: '(start)' }, { role: 'assistant', content: 'q' }, { role: 'user', content: 'a\nb' }]);
    const body = openRouterBody('m:free', 'SYS', [{ role: 'user', text: 'hi' }]) as { model: string; response_format: unknown; messages: { role: string; content: string }[] };
    expect(body.model).toBe('m:free');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0]?.role).toBe('system');
    expect(body.messages[0]?.content.startsWith('SYS')).toBe(true);
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hi' });
  });
});
