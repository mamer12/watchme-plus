# spark-tonight (Edge Function)

The AI chat behind "Spark Tonight". It asks the user short questions with Gemini and returns *filters* (never titles);
the app turns the filters into real titles from its own catalog.

- Needs a Supabase user JWT (anonymous users count). Limit: 30 requests per hour per user (`spark_tonight_hit()` from
  `supabase/migrations/0004_spark_tonight.sql`), at most 12 user turns per chat, small input caps.
- `validate.ts` is pure and shared with the app (and unit-tested by vitest).

## Deploy (you run these yourself)

1. SQL Editor: run `supabase/migrations/0004_spark_tonight.sql`, then optionally `supabase/tests/spark_tonight_test.sql`.
2. Secrets (type the key in your own terminal, never in the repo or in chat):
   ```
   supabase secrets set GEMINI_API_KEY=...
   ```
   Optional: `GEMINI_MODEL` (default `gemini-3.1-flash-lite`), `SPARK_NAME` (the brand used in the prompt, default
   `Spark`), `ALLOWED_ORIGINS` (comma separated, default the Vercel site and `http://localhost:5173`).
3. Deploy:
   ```
   supabase functions deploy spark-tonight
   ```
Without the function or the key the app falls back to a fixed set of questions.
