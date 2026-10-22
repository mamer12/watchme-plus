/**
 * Pure provider logic for the Edge Function (no imports, no Deno APIs): which providers to try and in which order,
 * and how to pull the model's JSON text out of each provider's response shape.
 */

export type ProviderName = 'gemini' | 'openrouter';

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
/** A free instruction-following model; override with OPENROUTER_MODEL (free ':free' ids change over time). */
export const DEFAULT_OPENROUTER_MODEL = 'meta-llama/llama-3.3-70b-instruct:free';

/** Gemini first (primary), OpenRouter after it; a provider without a key is left out. */
export function providerOrder(keys: { gemini?: string; openrouter?: string }): ProviderName[] {
  const out: ProviderName[] = [];
  if (keys.gemini?.trim()) out.push('gemini');
  if (keys.openrouter?.trim()) out.push('openrouter');
  return out;
}

/** The text Gemini's generateContent returned, or null. */
export function extractGeminiText(data: unknown): string | null {
  const d = data as { candidates?: { content?: { parts?: { text?: unknown }[] } }[] } | null;
  const text = d?.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === 'string' && text.trim() ? text : null;
}

/** The text an OpenAI-style chat completion (OpenRouter) returned, or null. Handles string and part-array content. */
export function extractOpenRouterText(data: unknown): string | null {
  const d = data as { choices?: { message?: { content?: unknown } }[] } | null;
  const content = d?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim() ? content : null;
  if (Array.isArray(content)) {
    const text = content.map((p) => (p && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : '')).join('');
    return text.trim() ? text : null;
  }
  return null;
}

/** Maps an HTTP status to a reason; every failure of the first provider moves on to the next one. */
export function reasonForStatus(status: number): string {
  return status === 429 ? 'model_busy' : 'model_error';
}

/** Merges consecutive same-role messages and starts with a user turn (some models reject anything else). */
export function toChatMessages(messages: { role: 'user' | 'assistant'; text: string }[]): { role: 'user' | 'assistant'; content: string }[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (!last && m.role === 'assistant') out.push({ role: 'user', content: '(start)' });
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) prev.content += `\n${m.text}`;
    else out.push({ role: m.role, content: m.text });
  }
  return out;
}

/** JSON-mode instruction: json_object has no schema, so the shape goes in the system prompt. */
export const OPENROUTER_SCHEMA_HINT = [
  'Reply with ONE JSON object and nothing else, exactly this shape:',
  '{"say": string, "choices": string[], "filters": null | {"type": "movie"|"tv"|"any", "genres": string[], "excludeGenres": string[], "maxMinutes"?: integer, "minYear"?: integer, "maxYear"?: integer, "lang"?: string, "keywords": string[]}}',
].join('\n');

export function openRouterBody(model: string, system: string, messages: { role: 'user' | 'assistant'; text: string }[]): Record<string, unknown> {
  return {
    model,
    messages: [{ role: 'system', content: `${system}\n\n${OPENROUTER_SCHEMA_HINT}` }, ...toChatMessages(messages)],
    response_format: { type: 'json_object' },
    temperature: 0.7,
    max_tokens: 600,
  };
}
