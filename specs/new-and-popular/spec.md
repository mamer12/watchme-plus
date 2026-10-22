# New & Popular

## Purpose

Netflix's "New & Hot", adapted: the catalog has no "Coming soon", so the page shows what's new, what's hot and the weekly
Top 10s, as large feature cards. Code: `src/features/newpopular/`.

## Requirements

### NEW-001: New Releases
The system SHALL list the latest movies and series (from `latestMovies` and `latestSeries`, interleaved) as feature
cards with art, title, Play, My List, More Info, year, age rating, kind, synopsis and genres.

- Verification: manual — open `/new`: the New Releases tab shows alternating new movies and series.
- Depends on: `latestMovies/...`, `latestSeries/...`

#### Scenario: Default tab
- GIVEN the page opens
- WHEN it loads
- THEN New Releases is selected

### NEW-002: Top 10 tabs
The system SHALL offer "Top 10 Series" and "Top 10 Movies" tabs with ranked feature cards, or a note when TMDB is not
reachable.

- Verification: manual — with a TMDB key, open each Top 10 tab: ten ranked cards; without a key, a short note.
- Depends on: HOME-004

#### Scenario: No TMDB
- GIVEN the proxy has no key
- WHEN Top 10 Movies is opened
- THEN a note explains the Top 10 needs TMDB

### NEW-003: Everyone's Watching
The system SHALL show the catalog's banner titles as "Everyone's Watching".

- Verification: manual — open the Everyone's Watching tab: the billboard titles are listed with their covers.
- Depends on: `banner/level/{l}`

#### Scenario: Banner list
- GIVEN 60+ banner titles
- WHEN the tab opens
- THEN they are listed as feature cards
