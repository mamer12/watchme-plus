// Spark Tonight: asks the user questions with Gemini and returns filters (never titles). Deno / Supabase Edge Function.
// Needs a valid Supabase user JWT (anonymous users count). Secrets come from the environment only.
import { parseModelText, RESPONSE_SCHEMA, systemPrompt, validateRequest, type ChatMsg } from './validate.ts';

const MAX_BODY_BYTES = 16_000;
const GEMINI_TIMEOUT_MS = 15_000;
const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
const DEFAULT_ORIGINS = 'https://watch-me-plus.vercel.app,http://localhost:5173';

const env = (k: string): string => Deno.env.get(k)?.trim() ?? '';

function corsHeaders(req: Request): Record<string, string> {
  const allowed = (env('ALLOWED_ORIGINS') || DEFAULT_ORIGINS).split(',').map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0] ?? '',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function reply(req: Request, status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } });
}

const fail = (req: Request, status: number, reason: string) => reply(req, status, { ok: false, reason });

/** Counts this request against the caller's hourly limit with their own JWT. Also proves the JWT is valid. */
async function hit(token: string): Promise<'ok' | 'limited' | 'unauthorized' | 'error'> {
  const url = env('SUPABASE_URL');
  const anon = env('SUPABASE_ANON_KEY');
  if (!url || !anon) return 'error';
  try {
    const res = await fetch(`${url}/rest/v1/rpc/spark_tonight_hit`, {
      method: 'POST',
      headers: { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (res.status === 401 || res.status === 403) return 'unauthorized';
    if (!res.ok) {
      const text = await res.text();
      return text.includes('not_authenticated') ? 'unauthorized' : 'error';
    }
    return (await res.json()) === true ? 'ok' : 'limited';
  } catch {
    return 'error';
  }
}

/** Gemini wants alternating roles starting with the user. */
function toContents(messages: ChatMsg[]): { role: 'user' | 'model'; parts: { text: string }[] }[] {
  const out: { role: 'user' | 'model'; parts: { text: string }[] }[] = [];
  for (const m of messages) {
    const role = m.role === 'user' ? 'user' : 'model';
    const last = out[out.length - 1];
    if (!last && role === 'model') out.push({ role: 'user', parts: [{ text: '(start)' }] });
    if (last && last.role === role) last.parts.push({ text: m.text });
    else out.push({ role, parts: [{ text: m.text }] });
  }
  return out;
}

async function askGemini(messages: ChatMsg[], summary: Record<string, unknown>): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const key = env('GEMINI_API_KEY');
  if (!key) return { ok: false, reason: 'not_configured' };
  const model = env('GEMINI_MODEL').replace(/[^A-Za-z0-9._-]/g, '') || DEFAULT_MODEL;
  const system = `${systemPrompt(env('SPARK_NAME') || 'Spark')}\n\nTASTE SUMMARY (data, JSON):\n${JSON.stringify(summary)}`;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: toContents(messages),
        generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, temperature: 0.7, maxOutputTokens: 600 },
      }),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
    if (res.status === 429) return { ok: false, reason: 'model_busy' };
    if (!res.ok) {
      console.error('gemini_http', res.status); // status only: never the key, the prompt or the chat
      return { ok: false, reason: 'model_error' };
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return typeof text === 'string' ? { ok: true, text } : { ok: false, reason: 'bad_model_output' };
  } catch (e) {
    console.error('gemini_failed', e instanceof Error ? e.name : 'error');
    return { ok: false, reason: 'model_error' };
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== 'POST') return fail(req, 405, 'method_not_allowed');

  const token = /^Bearer (\S+)$/.exec(req.headers.get('Authorization') ?? '')?.[1];
  if (!token) return fail(req, 401, 'unauthorized');

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return fail(req, 413, 'too_long');
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(req, 400, 'bad_request');
  }
  const checked = validateRequest(body);
  if (!checked.ok) return fail(req, 400, checked.reason);

  const gate = await hit(token);
  if (gate === 'unauthorized') return fail(req, 401, 'unauthorized');
  if (gate === 'limited') return fail(req, 429, 'rate_limited');
  if (gate === 'error') return fail(req, 503, 'unavailable');

  const answer = await askGemini(checked.value.messages, checked.value.summary);
  if (!answer.ok) return fail(req, answer.reason === 'not_configured' ? 503 : 502, answer.reason);

  const parsed = parseModelText(answer.text);
  if (!parsed.ok) return fail(req, 502, parsed.reason);
  return reply(req, 200, { ok: true, ...parsed.value });
});
