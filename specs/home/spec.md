# Home, Movies and Series

## Purpose

The browse pages: a rotating billboard and Netflix-style rows, personalised from the user's history, ratings and
onboarding. Home mixes movies and series; `/movies` and `/series` show one kind with their own billboard and genre
rows. Code: `src/features/home/`, `src/components/Billboard.tsx`, `Row.tsx`, `TitleRow.tsx`, `Top10Row.tsx`.

## Requirements

### HOME-001: Billboard
The system SHALL show a billboard built from `banner/level/{l}` titles that have a wide cover (filtered by kind on
Movies/Series, falling back to the latest titles), with the cover art, title, year, age rating, length,
synopsis, Play and More Info buttons, rotating every 10 seconds with focusable dot buttons; on touch screens a
sideways swipe of 40px or more moves to the next (left) or previous (right) title. Rotation pauses while the pointer
or keyboard focus is on the billboard and is off with reduced motion.

- Verification: manual — open `/` on desktop and phone width: the cover fills the hero, Play starts the title,
  More Info opens the modal, the dots change slides, a swipe on a phone changes the slide and slides rotate after
  10 s.
- Depends on: `banner/level/{l}`

#### Scenario: Rotation
- GIVEN the billboard has several banner titles and no preview is playing
- WHEN 10 seconds pass
- THEN the next title is shown

### HOME-002: Muted preview
The system SHALL autoplay a muted preview on the billboard only on a desktop with a fine pointer, after 3 seconds,
using the 480p (else 360p) file from the resume point (or 0 when there is none or it is in the last 15%), with a mute
toggle, and SHALL never autoplay on touch
devices, with data saver or 2G, with reduced motion, when the setting is off, while the title modal is open or when
the billboard is off-screen.

- Verification: test
- Depends on: `transcoddedFiles/id/{nb}`, SET-003

#### Scenario: Phone
- GIVEN a touch device
- WHEN the home page stays open
- THEN no video is requested for the billboard

### HOME-003: Continue Watching
The system SHALL show a Continue Watching row first, newest first: unfinished movies with their progress, and for each
series the current (or next, after finishing an episode) episode with a progress bar and an "S1:E3" label; each item
can be removed and plays directly when clicked.

- Verification: test
- Depends on: PLAYER-010

#### Scenario: Finished an episode
- GIVEN the user finished S1:E1
- WHEN Home is shown
- THEN Continue Watching shows the series at S1:E2 with an empty progress bar

### HOME-004: Top 10
The system SHALL show "Top 10 Movies This Week" and "Top 10 Series This Week" from TMDB `/trending/{movie|tv}/week`
matched to the catalog (TMDB-007), with large outlined rank numerals beside portrait posters, hidden when fewer than 3
match or TMDB is unavailable.

- Verification: test
- Depends on: TMDB proxy

#### Scenario: Title not on the catalog
- GIVEN the third trending film isn't on the catalog
- WHEN the row is built
- THEN it is skipped and the next matches fill the 10 places

### HOME-005: Top Picks for You
The system SHALL rank candidates (curated groups, latest titles, the user's top genres and TMDB's recommendations for
up to three titles the user loved, else liked) by genre affinity from onboarding genres, ratings (love 3, like 2,
dislike −3) and watch history, adding 4 to a title recommended for a loved title and 2.5 for a liked one, and excluding
disliked, finished, in-progress and the seed titles themselves.

- Verification: test

#### Scenario: Sci-Fi fan
- GIVEN the user loved a Sci-Fi title and picked Sci-Fi in onboarding
- WHEN Top Picks is built
- THEN Sci-Fi titles rank first and disliked ones are absent

### HOME-006: Because You…
The system SHALL show up to three rows from TMDB recommendations matched to the catalog, seeded by titles with an IMDb id
in this order: rated love ("Because You Loved X"), most recently watched ("Because You Watched X"), then rated like,
which includes onboarding picks ("Because You Liked X"); disliked titles never seed a row.

- Verification: test
- Depends on: TMDB-006, TMDB-007

#### Scenario: New user after onboarding
- GIVEN no history but liked titles from onboarding
- WHEN Home is shown
- THEN the rows are based on the liked titles and say "Because You Liked"

### HOME-007: My List row
The system SHALL show the user's My List as a row (filtered by kind on Movies/Series).

- Verification: manual — add a title with + and check it appears in the My List row on Home and, by kind, on
  Movies or Series.

#### Scenario: Added a movie
- GIVEN a movie was added to My List
- WHEN the Series page is opened
- THEN its My List row does not include the movie

### HOME-008: Curated, new and genre rows
The system SHALL show the catalog's curated groups, "New Release Movies" and "New Episodes & Series" (latest lists) and
genre rows from `AdvancedSearch&category_id`, ordering genres by the user's affinity, loading each genre row only
when it nears the viewport and hiding rows with too few titles.

- Verification: test
- Depends on: `videoGroups`, `latestMovies`, `latestSeries`, `AdvancedSearch&category_id&year=2010,2030`

#### Scenario: Genre alias
- GIVEN a title genre "Science Fiction"
- WHEN mapped to a the catalog category
- THEN the Sci-Fi id 78 is used

### HOME-009: Movies and Series pages
The system SHALL offer `/movies` and `/series`, each with a billboard, rows and genre rows of that kind only.

- Verification: manual — open `/movies`: every row and the billboard contain only movies; same for `/series`.

#### Scenario: Series page
- GIVEN the Series page
- WHEN rows load
- THEN no movie appears

### HOME-010: Row behaviour
The system SHALL lay rows out horizontally with arrow buttons on desktop (paging by a screen width) and touch
swiping with scroll snapping on mobile, with skeletons while loading.

- Verification: manual — on desktop hover a row and use the arrows; on a phone swipe a row; while loading grey
  skeleton cards keep the layout steady.

#### Scenario: Desktop arrows
- GIVEN a row wider than the screen
- WHEN the right arrow is clicked
- THEN the row scrolls by about one screen

### HOME-011: Row order
The system SHALL order Home, Movies and Series as the TV app does: Continue Watching, Top Picks for You, the first
"Because You…" row, Top 10 Movies, Top 10 Series, the other "Because You…" rows, My List, then the new, curated and
genre rows.

- Verification: manual — after onboarding with a few picks, open `/` on a phone: Top Picks and a "Because You Liked"
  row show right under the billboard (under Continue Watching once something was watched), before the Top 10s.

#### Scenario: Just onboarded
- GIVEN the user finished onboarding with three liked titles and nothing watched
- WHEN Home is shown
- THEN Top Picks for You is the first row and "Because You Liked …" the second
