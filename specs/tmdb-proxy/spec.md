# TMDB proxy and client

## Purpose

Use TMDB for box art (textless backdrops and logos), the weekly Top 10, "Because You Watched" and the all-time
popular titles of onboarding, without ever exposing the TMDB key. The serverless function `api/tmdb.ts` holds the
key (`TMDB_KEY`); the client (`src/api/tmdb.ts`) only calls `/api/tmdb?path=...`. Everything TMDB-based is optional:
the app works without it.

## Requirements

### TMDB-001: Path allow-list
The proxy SHALL forward only GET paths that start with `/find/`, `/movie/`, `/tv/`, `/trending/` or `/discover/`,
made of URL-safe characters, without `..` or `//`, to `https://api.themoviedb.org/3`, and SHALL refuse anything
else (400/403).

- Verification: test

#### Scenario: Attempt to reach another host
- GIVEN `path=//evil.com/movie/1` or `path=https://evil.com/...`
- WHEN the proxy is called
- THEN it answers 400 without contacting TMDB

### TMDB-002: Key handling
The proxy SHALL send a key starting with `eyJ` as `Authorization: Bearer`, otherwise append it as `api_key`, and
SHALL drop any `api_key` the client sends. The key SHALL NOT appear in client code, the repository or responses.

- Verification: test

#### Scenario: v3 key
- GIVEN `TMDB_KEY=abc123`
- WHEN `/movie/1?language=en` is requested
- THEN the upstream URL is `.../3/movie/1?language=en&api_key=abc123`

### TMDB-003: Caching and missing key
The proxy SHALL answer successful requests with `Cache-Control: public, max-age=3600, s-maxage=86400,
stale-while-revalidate=604800` and SHALL answer 503 when `TMDB_KEY` is not set.

- Verification: test

#### Scenario: Not configured
- GIVEN no `TMDB_KEY`
- WHEN any path is requested
- THEN the answer is 503 and the app falls back (TMDB-008)

### TMDB-004: Abuse and leaks
The proxy SHALL rate-limit each client IP (240 requests/minute per instance) and SHALL NOT pass upstream error
bodies through (502/404/504 with a generic message).

- Verification: test

#### Scenario: Upstream 500
- GIVEN TMDB fails with details in its body
- WHEN the proxy answers
- THEN the status is 502 and the body has no upstream details

### TMDB-005: Box art selection
The client SHALL pick the largest textless backdrop (`iso_639_1` null) at `w780` (falling back to any backdrop) and
the best logo per language (PNG first, then votes) at `w500`, from `/{movie|tv}/{id}/images?include_image_language=en,ar,null`.

- Verification: test

#### Scenario: Backdrop with text
- GIVEN a 4K English backdrop and a 1920px textless one
- WHEN art is chosen
- THEN the textless 1920px backdrop wins

### TMDB-006: IMDb lookup
The client SHALL resolve a the catalog `imdbUrlRef` (tt id) with `/find/{tt}?external_source=imdb_id`, preferring TV
results for series (including an episode's `show_id`) and movie results for movies.

- Verification: test

#### Scenario: Episode id for a series
- GIVEN `/find` returns only `tv_episode_results[0].show_id = 1399`
- WHEN looking up a series
- THEN the TV id 1399 is used

### TMDB-007: Matching TMDB titles to the catalog
The client SHALL match TMDB titles to the catalog by searching `AdvancedSearch` with the name (and the original name),
comparing names normalized (lowercase, accents and non-alphanumerics removed, `&` as "and", Arabic letters kept) and
accepting a year difference of ±1, preferring the exact year.

- Verification: test
- Depends on: `AdvancedSearch?level&videoTitle&type&page`

#### Scenario: Remake with the same name
- GIVEN the catalog has "Dune" 1984 and 2021
- WHEN matching TMDB "Dune" 2021
- THEN the 2021 title is chosen

### TMDB-008: Degrading without TMDB
The client SHALL stop calling the proxy for the session after 4 consecutive failures; then cards fall back to
posters, and the Top 10 and "Because You Watched" rows are hidden.

- Verification: test

#### Scenario: No key in production
- GIVEN the proxy answers 503
- WHEN the home page loads
- THEN after a few failures no more proxy requests are made and the page still shows every the catalog row

### TMDB-009: Client caches
The client SHALL cache box art per IMDb id (14 days; misses 2 days) and the catalog matches per TMDB id and level
(7 days) in localStorage.

- Verification: test

#### Scenario: Second visit
- GIVEN art for tt1 was fetched once
- WHEN a card for tt1 renders again
- THEN no request is made

### TMDB-010: All-time popular titles
The client SHALL get the all-time most popular titles with `/discover/{movie|tv}?sort_by=vote_count.desc&with_genres=<ids joined by |>`
for pages 1 and 2, mapping the catalog genres to TMDB genre ids (movies: Action 28, Adventure 12, Animation 16, Comedy 35,
Crime 80, Documentary 99, Drama 18, Fantasy 14, Horror 27, Mystery 9648, Romance 10749, Sci-Fi 878, Thriller 53,
Western 37; TV: Action/Adventure 10759, Animation 16, Comedy 35, Crime 80, Documentary 99, Drama 18, Mystery 9648,
Sci-Fi/Fantasy 10765, Western 37), merged and sorted by vote count.

- Verification: test
- Depends on: ONB-004

#### Scenario: Action and Sci-Fi movies
- GIVEN genres Action and Sci-Fi
- WHEN popular movies are requested
- THEN the query uses `with_genres=28|878` and results are ordered by vote count
