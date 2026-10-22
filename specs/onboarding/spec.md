# Onboarding

## Purpose

A first-run flow that seeds recommendations: what kind of titles, which genres, and which all-time favourites the
user has watched or liked. Code: `src/features/onboarding/`. Single user, no profiles or login.

## Requirements

### ONB-001: First run
The system SHALL send a new user to `/welcome` before any browse page until onboarding is done or skipped (the player
stays reachable by direct link), and SHALL allow redoing it from Settings.

- Verification: test

#### Scenario: Fresh browser
- GIVEN no saved state
- WHEN `/` is opened
- THEN the onboarding shows

### ONB-002: Kind
The system SHALL ask whether the user mostly watches movies, series or both.

- Verification: manual — step 1 shows Movies, Series and Both; the choice is kept when going back.

#### Scenario: Series
- GIVEN Series is chosen
- WHEN the title step loads
- THEN only series are offered

### ONB-003: Genres
The system SHALL let the user pick any number of the 15 the catalog genres.

- Verification: manual — step 2 shows 15 genre chips that toggle; Continue works with none selected.

#### Scenario: No genres
- GIVEN no genre is picked
- WHEN Continue is pressed
- THEN popular titles across all genres are offered

### ONB-004: All-time popular titles
The system SHALL offer about 36 of the most popular titles of all time in the picked genres — TMDB `/discover` sorted
by vote count, pages 1–2 (TMDB-010) — keeping only titles the catalog has (matched by name and year, TMDB-007),
interleaving movies and series when both were chosen.

- Verification: test
- Depends on: TMDB proxy, `AdvancedSearch`

#### Scenario: Both kinds
- GIVEN Both and genres Action, Sci-Fi
- WHEN the title step loads
- THEN highly voted movies and series alternate, and every one of them opens on the catalog

### ONB-005: Fallback without TMDB
The system SHALL fall back to the catalog's genre lists (highest IMDb stars first) when TMDB is unavailable or matches too
few titles.

- Verification: manual — without `TMDB_KEY`, run onboarding: step 3 still shows posters from the chosen genres.
- Depends on: `AdvancedSearch&category_id`

#### Scenario: Proxy down
- GIVEN `/api/tmdb` fails
- WHEN the title step loads
- THEN the catalog genre titles are shown

### ONB-006: Seeding recommendations
The system SHALL store the chosen kind and genres and save every ticked title as "like", which feeds Top Picks,
"Because You Liked" rows and Top Picks.

- Verification: test

#### Scenario: Three likes
- GIVEN three titles ticked
- WHEN Done is pressed
- THEN they are rated "like" and Home opens
