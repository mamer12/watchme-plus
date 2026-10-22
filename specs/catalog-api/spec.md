# Catalog API (Catalog)

## Purpose

Read the streaming catalog straight from the browser and turn whatever comes back into safe, typed
models. The catalog's own app crashes on nulls; Watchme+ must not. Code: `src/api/http.ts`, `src/api/parse.ts`,
`src/api/catalog.ts`, `src/lib/ratings.ts`.

Base URL: the catalog server's `/api/android/` (CORS `*`). Endpoints: `videoGroups/lang/{lang}/level/{l}`,
`banner/level/{l}`, `latestMovies|latestSeries/level/{l}/itemsPerPage/{n}/page/{p}/`, `AdvancedSearch`,
`mainCategories`, `allVideoInfo/id/{nb}`, `videoSeason/id/{nb}`, `transcoddedFiles/id/{nb}`, `translationFiles/id/{nb}`.

## Requirements

### API-001: Defensive title parsing
The system SHALL parse every title field as optional (missing, JSON null, number or string) and SHALL drop
entries without a numeric `nb` or without any title, never throwing.

- Verification: test
- Depends on: every list endpoint

#### Scenario: Strings and nulls
- GIVEN an item with `year: "2026"`, `stars: "7.3"`, `categories` containing `null`
- WHEN it is parsed
- THEN year is 2026, stars 7.3, and the null genre is skipped

#### Scenario: Junk response
- GIVEN an HTML error page or `null` instead of a list
- WHEN it is parsed as a title list
- THEN the result is an empty list and duplicates by `nb` are removed

### API-002: Image URLs
The system SHALL make image paths absolute (prefixing `https://cnth2.shabakaty.com/` to bare paths), upgrade
`http` to `https`, ignore the catalog's "not available" placeholders, and SHALL treat an `imgObjUrl` containing
`cover-images` as the wide banner cover, using `imgMediumThumbObjUrl` as the poster.

- Verification: test
- Depends on: `banner/level/{l}` (`imgObjUrl`, `imgMediumThumbObjUrl`)

#### Scenario: Banner item
- GIVEN a banner item whose `imgObjUrl` is a cover and whose medium thumb is a bare path
- WHEN it is parsed
- THEN `cover` is the cover URL and `poster` is the medium thumb on the image host

### API-003: Episode order
The system SHALL sort a series' episodes by season, then episode number (both sent as strings).

- Verification: test
- Depends on: `videoSeason/id/{nb}` (unsorted)

#### Scenario: Unsorted season list
- GIVEN episodes S2E1, S1E10, S1E2
- WHEN they are parsed
- THEN the order is S1E2, S1E10, S2E1

### API-004: Title details
The system SHALL parse `allVideoInfo` into details with cast, directors (role suffixes like "(Written by)"
removed), intro skip ranges from `introSkipping[{start,end}]` and family skip ranges from
`skippingDurations{start[],end[]}`, ignoring malformed ranges.

- Verification: test
- Depends on: `allVideoInfo/id/{nb}`

#### Scenario: Skip ranges as strings
- GIVEN `introSkipping: [{start:"227.99", end:"246.61"}]` and `skippingDurations` with an unmatched start
- WHEN details are parsed
- THEN one intro range and only the complete family ranges are kept, sorted

### API-005: Video files
The system SHALL parse `transcoddedFiles` into files sorted by height, dropping entries without a resolution or
an https URL, one file per height.

- Verification: test
- Depends on: `transcoddedFiles/id/{nb}`

#### Scenario: Broken entries
- GIVEN files 1080p, 240p, one without resolution and one without URL
- WHEN parsed
- THEN the result is 240p, 1080p

### API-006: Subtitle files
The system SHALL read `arTranslationFilePath` and `enTranslationFilePath`, returning null for missing ones.

- Verification: test
- Depends on: `translationFiles/id/{nb}`

#### Scenario: Only Arabic
- GIVEN an empty English path
- WHEN parsed
- THEN `en` is null and `ar` is the URL

### API-007: Groups and categories
The system SHALL parse curated groups (`{groups:[{title, groupsID, content}]}`), skipping empty or untitled
groups, and `mainCategories` into `{id, title}`.

- Verification: test
- Depends on: `videoGroups/...`, `mainCategories?lang=en`

#### Scenario: Empty group
- GIVEN a group whose `content` is null
- WHEN groups are parsed
- THEN that group is left out

### API-008: Retries with backoff
The system SHALL retry a failed request up to 3 times with exponential backoff (400, 800, 1600 ms), treating
non-2xx answers, network errors, empty bodies and HTML bodies as failures.

- Verification: test

#### Scenario: Flaky API
- GIVEN the API answers 502, then HTML, then a network error, then JSON
- WHEN a list is fetched
- THEN the JSON is returned after 4 attempts

### API-009: Last-good cache
The system SHALL keep the last good JSON of each catalog request in localStorage (evicting the oldest half on
quota errors) and SHALL serve it when all retries fail, so the UI is never empty.

- Verification: test

#### Scenario: API down after a good visit
- GIVEN a successful earlier response for a URL
- WHEN every retry fails
- THEN the saved response is returned

### API-010: Family level on every call
The system SHALL pass the family level (0 all, 2 family, 3 kids) to every list, banner, group, search and genre
request.

- Verification: test
- Depends on: Settings (SET-001)

#### Scenario: Family level
- GIVEN level 2
- WHEN the banner, groups, latest, search and genre URLs are built
- THEN each one carries level 2

### API-011: Client-side rating guard
The system SHALL hide titles whose film/series rating exceeds the level (family: up to PG-13 / TV-14; kids: up
to PG / TV-PG) wherever titles come from outside a level-filtered list (deep links, TMDB matches, groups); unknown
ratings pass the family level but not the kids level.

- Verification: test

#### Scenario: R movie at family level
- GIVEN a movie rated R (4)
- WHEN the level is 2
- THEN it is not allowed

### API-012: Age labels
The system SHALL label `filmRating` 1–5 as G, PG, PG-13, R, NC-17 and `seriesRating` 1–6 as TV-Y, TV-Y7, TV-G,
TV-PG, TV-14, TV-MA, choosing by kind, and show nothing for unknown codes.

- Verification: test

#### Scenario: Series rating
- GIVEN a series with `seriesRating: "6"`
- WHEN labelled
- THEN the label is TV-MA

### API-013: Request sharing
The system SHALL share one network request between simultaneous callers of the same URL and reuse answers from
memory for 5 minutes.

- Verification: test

#### Scenario: Two rows ask at once
- GIVEN two components requesting the same URL at the same time
- WHEN both resolve
- THEN only one request was made

### API-014: Signed links are not stored
The system SHALL NOT persist video file and subtitle file answers (their signed CDN links expire).

- Verification: test

#### Scenario: Video files
- GIVEN a `transcoddedFiles` answer
- WHEN it is fetched
- THEN nothing is written to localStorage

### ISP-001: Host per provider
The system SHALL call the default catalog server when the provider is "EL" and the mirror server (`cee.buzz`, over
https) when it is "Other"; both hostnames are written only in `src/api/endpoints.ts`.

- Verification: test
- Depends on: every endpoint under `/api/android/`

#### Scenario: Other
- GIVEN the provider is Other
- WHEN `apiBase()` is read
- THEN it is `https://cee.buzz/api/android/`

### ISP-002: EL by default
The system SHALL default to "EL" before detection has answered, when no choice is stored, when the stored value is not recognised, or when storage is
unavailable, so existing users keep working.

- Verification: test

#### Scenario: Fresh browser
- GIVEN nothing is stored
- WHEN the provider is read
- THEN it is EL

### ISP-003: Choice persists
The system SHALL store the provider in localStorage under `wmp:isp` and read it back on the next load.

- Verification: test

#### Scenario: Reload
- GIVEN the user chose Other
- WHEN the app loads again
- THEN the provider is Other

### ISP-004: Base URL at call time
The system SHALL compute the API base from the current provider every time a URL is built, so a switch takes effect on
the next request without a reload.

- Verification: test
- Depends on: `endpoints()`

#### Scenario: Switch
- GIVEN EL was in use
- WHEN the provider becomes Other
- THEN the next built URL uses `cee.buzz`

### ISP-005: Switching invalidates cached data
The system SHALL, on a provider change, drop cached API answers (memory and the localStorage last-good copies, never
the user's library) and reload the visible data, because query keys include the provider.

- Verification: test

#### Scenario: Switch after browsing
- GIVEN rows were cached from EL
- WHEN the user switches to Other
- THEN the cached answers are gone and the next request goes to the network

### ISP-006: Images and CDN links on both sides
The system SHALL prefix bare image paths with the current provider's image host, keep absolute CDN URLs from either
side as they are, re-point stored artwork links to the current provider's image host, and the service worker and
preconnect hints SHALL cover both providers' hosts.

- Verification: test
- Depends on: `parse.url`, `Img`, `pwa.config.ts`

#### Scenario: Old My List poster
- GIVEN a poster URL saved while on EL
- WHEN it is shown while on Other
- THEN it loads from the mirror's image host

### ISP-007: Network-failure report
The system SHALL remember when a catalog request fails with a network error (no answer, as opposed to an HTTP or
parse error), clear that when any catalog request succeeds, and tell provider detection about every outcome (PROV-006).

- Verification: test
- Depends on: `src/api/health.ts`

#### Scenario: Blocked network
- GIVEN the user is on EL and requests fail to connect
- WHEN retries run out
- THEN the failure is reported until a request succeeds

### PERF-009: Reused answers
The system SHALL reuse an answer for the same request for about 8 minutes (shared by every component asking for it)
before asking again.

- Verification: test
- Depends on: `src/hooks/useQuery.ts`, `src/api/http.ts`

#### Scenario: Back to Home
- GIVEN Home loaded 2 minutes ago
- WHEN the viewer returns to it
- THEN no catalog request is made
