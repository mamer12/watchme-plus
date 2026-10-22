# Search

## Purpose

Instant search across movies and series in Arabic or English, plus genre browsing and Netflix's "Top Searches".
Code: `src/features/search/`.

Depends on: `AdvancedSearch?level&videoTitle&type={movies|series}&page`, TMDB Top 10 (optional), `banner`.

## Requirements

### SEARCH-001: Instant results
The system SHALL search movies and series in parallel 350 ms after the user stops typing, merge both answers without
duplicates, put titles that start with the query first, and keep the query in the URL (`/search?q=`).

- Verification: test

#### Scenario: "batman"
- GIVEN movie and series answers that share a title
- WHEN merged
- THEN the shared title appears once and prefix matches come first

### SEARCH-002: Arabic and English input
The system SHALL accept Arabic or English queries (input `dir="auto"`) and URL-encode them for the API.

- Verification: test

#### Scenario: Arabic query
- GIVEN the query "الحمل"
- WHEN the request is built
- THEN `videoTitle=%D8%A7%D9%84%D8%AD%D9%85%D9%84`

### SEARCH-003: Empty state
The system SHALL, before typing, show genre chips (each opening that genre's movies and series) and a "Top Searches"
list (Top 10s when TMDB is available, then the catalog's banner titles) with a play button per row.

- Verification: manual — open `/search` with an empty box: genre chips and Top Searches show; a chip lists that genre.

#### Scenario: Genre chip
- GIVEN the empty search page
- WHEN "Comedy" is pressed
- THEN comedy movies and series are listed and the URL is `/search?genre=59`

### SEARCH-004: No results
The system SHALL say when nothing matched (or when search isn't responding) and suggest genres.

- Verification: manual — search "zzzzqqq": a "No matches" message with genre suggestions appears.

#### Scenario: Nonsense query
- GIVEN a query with no matches
- WHEN results arrive
- THEN a friendly message and genre chips are shown
