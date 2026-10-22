# Tonight

## Purpose

An AI chat ("Spark Tonight") that keeps asking short questions (who is watching, mood, what they like, how much time)
and then shows real titles from the catalog. The AI only asks and returns filters; it never names titles. Without the
function, a key or a session, a fixed set of questions does the same job. Normal search is never affected.
Code: `src/features/tonight/`, `supabase/functions/spark-tonight/`, `supabase/migrations/0004_spark_tonight.sql`.

Depends on: `/api/tmdb` (discover), catalog search matching, the sync session (a guest or account token), Supabase Edge
Function `spark-tonight`.

## Requirements

### TONIGHT-001: Taste summary
The system SHALL build, without network access, a compact summary of the active profile's taste (top genres with weights, language, eras, up to 10 recent, 10 liked and 5 disliked titles) from watched, ratings, My List and continue-watching data.

- Verification: test

#### Scenario: Taste summary
- GIVEN a library with a loved comedy, a liked drama, a disliked horror film and a series in progress
- WHEN the summary is built
- THEN comedy leads the genres, recent titles are newest first, liked comes from ratings then My List, and the disliked title is listed apart

### TONIGHT-002: Summary size and privacy
The system SHALL keep the taste summary under 1500 bytes of JSON by dropping the least useful items, and SHALL NOT include account ids, title ids or emails.

- Verification: test

#### Scenario: Summary size and privacy
- GIVEN a library with 80 rated titles
- WHEN the summary is built
- THEN it fits the cap, lists stay within their limits, and the JSON holds no id or email

### TONIGHT-003: Time context
The system SHALL add the weekday, the hour and an `isWeekendEve` flag that is true on Thursday evening (the start of the Iraqi weekend).

- Verification: test

#### Scenario: Time context
- GIVEN Thursday 21:00
- WHEN the summary is built
- THEN `isWeekendEve` is true; on Thursday morning or any other day it is false

### TONIGHT-004: Fixed questions
The system SHALL, when the AI is not available, ask fixed questions (who is watching, film or series, mood, length) in English and Arabic and map the answers to the same `filters` shape the AI returns.

- Verification: test

#### Scenario: Fixed questions
- GIVEN the answers family, film, light, short
- WHEN mapped
- THEN type is movie, genres include comedy and family, horror is excluded and the runtime limit is 100 minutes

### TONIGHT-005: Conversation limits
The system SHALL end a conversation after 12 user answers with neutral filters, send at most the last 20 messages to the AI, ignore empty input and ignore answers while a reply is pending.

- Verification: test

#### Scenario: Conversation limits
- GIVEN 12 answers without filters from the AI
- WHEN the 12th reply arrives
- THEN the chat is done and a further answer is ignored

### TONIGHT-006: Fall back on failure
The system SHALL switch to the fixed questions, from the first one, when the AI call fails for any reason.

- Verification: test

#### Scenario: Fall back on failure
- GIVEN a chat with the AI that fails
- WHEN the failure is applied
- THEN the chat asks the first fixed question with its choices

### TONIGHT-007: Request validation
The system SHALL, in the Edge Function, accept only a list of at most 24 messages with at most 12 user turns, texts up to 400 characters, a last message from the user and a taste summary up to 2000 bytes.

- Verification: test

#### Scenario: Request validation
- GIVEN 13 user turns
- WHEN validated
- THEN the request is refused with `too_many_turns`

### TONIGHT-008: Model reply validation
The system SHALL treat the model's JSON as untrusted: rebuild the filters with known genre names, bounded numbers and a two-letter language, cap the choices at 5 and the text sizes, strip control characters, and refuse a reply without text or without a next step. The prompt SHALL forbid naming titles and takes the product name as a parameter.

- Verification: test

#### Scenario: Model reply validation
- GIVEN a reply with an unknown genre, 5000 minutes and 7 choices
- WHEN sanitized
- THEN the unknown genre and the number are dropped and no more than 5 choices remain

### TONIGHT-009: Filters to titles
The system SHALL turn filters into a TMDB discover request the proxy accepts, and keep only matched catalog titles that fit the type, excluded genres, years, film runtime and family level, and that the user has not watched.

- Verification: test

#### Scenario: Filters to titles
- GIVEN films with a horror genre, a long runtime and an old year
- WHEN filtered with comedy-only limits
- THEN only the fitting film remains

### TONIGHT-010: Ranking and reasons
The system SHALL rank candidates by the requested genres and the profile's taste, and give each a one-line reason built from what matched (genre, liked genre, runtime, rating), in English or Arabic.

- Verification: test

#### Scenario: Ranking and reasons
- GIVEN a comedy request and a comedy, a drama and a western title
- WHEN ranked
- THEN the comedy is first and its reason says it matches the mood

### TONIGHT-011: Resolver fallbacks
The system SHALL loosen the filters step by step when nothing matches, use the catalog's genre lists when TMDB is unavailable, and return an empty list (shown as a friendly message) when nothing is found.

- Verification: test

#### Scenario: Resolver fallbacks
- GIVEN a 50 minute limit that matches nothing
- WHEN resolved
- THEN the limit is dropped and the matching title is returned

### TONIGHT-012: API client
The system SHALL call the `spark-tonight` function with the user's session token, a timeout and a validated reply, and turn every failure (no config, no session, rate limit, timeout, network, bad reply) into a reason.

- Verification: test

#### Scenario: API client
- GIVEN a 429 answer
- WHEN the client reads it
- THEN the reason is `rate_limited`

### TONIGHT-013: Search is untouched
The system SHALL keep normal search independent of Tonight: no search module imports Tonight, no shared module imports it, the only change to the search page is a link to `/tonight`, and the route is loaded lazily.

- Verification: test

#### Scenario: Search is untouched
- GIVEN the source of the search feature
- WHEN its imports are read
- THEN none refers to Tonight

### TONIGHT-014: Function access and limits
The system SHALL require a valid Supabase user JWT (anonymous users count), allow 30 requests per user per hour through `spark_tonight_hit()`, store only user id and time, read `GEMINI_API_KEY` from the environment, and answer `{ok:false, reason}` on any failure.

- Verification: manual — run the SQL test, deploy the function, then ask one question and send 31 requests in an hour from one user.

#### Scenario: Function access and limits
- GIVEN the SQL test `supabase/tests/spark_tonight_test.sql` run after migration 0004
- WHEN it finishes
- THEN it prints PASS notices; with the function deployed and a key set, a signed-in user gets a question back and the 31st request in an hour gets `rate_limited`

### TONIGHT-015: Tonight screen
The system SHALL show the chat as bubbles with quick-reply chips, a free-text box, a Start over button and a grid of picks with their reasons, in right-to-left layout for Arabic, usable with the keyboard, and say when it falls back to fixed questions.

- Verification: manual — open `/tonight` in Arabic and English, with and without the function; check RTL, Tab order and the picks.

#### Scenario: Tonight screen
- GIVEN /tonight with the language set to Arabic and no function deployed
- WHEN opened and the four questions are answered
- THEN the layout is right-to-left, Tab reaches the chips, the input and the cards, and real titles with reasons appear

### TONIGHT-016: Provider fallback
The system SHALL try Gemini first and OpenRouter second, using only the providers whose key is set, and SHALL answer `{ok:false, reason}` when none is set or all fail (quota, 5xx, timeout or invalid JSON all move on to the next provider).

- Verification: test

#### Scenario: Provider fallback
- GIVEN both keys set, or only one, or none
- WHEN the provider order is computed
- THEN it is gemini then openrouter, only the one set, or empty

### TONIGHT-017: Provider response extraction
The system SHALL read the model's JSON text from Gemini's and OpenRouter's response shapes, build the OpenRouter JSON-mode request with the same system prompt and history, and pass either text through the same sanitizer.

- Verification: test

#### Scenario: Provider response extraction
- GIVEN a Gemini candidate, an OpenRouter choice, and malformed bodies
- WHEN the text is extracted and sanitized
- THEN both valid shapes give the same reply and malformed ones give null or `bad_model_output`
