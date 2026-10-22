# Title page ("More Info")

## Purpose

Everything about one title, as Netflix's modal: hero, actions, details, episodes and more like this (the trailer plays in the hero).
Deep-linkable at `/title/:id`. Code: `src/features/title/`.

Depends on: `allVideoInfo/id/{nb}`, `videoSeason/id/{nb}`, `AdvancedSearch&category_id`, TMDB art.

## Requirements

### TITLE-001: Modal and deep link
The system SHALL open titles as a modal over the page they were opened from (closing returns there and gives focus back
to the opener, Escape closes, the page behind is inert) and SHALL render `/title/:id` opened directly as the same modal
over Home. Its close button SHALL stay on screen while the page scrolls and, on phones, sit below the status bar and
notch (the safe area), where taps reach it.

- Verification: manual — open a title from a row, close it: the row is where it was; paste `/title/24194` in a new
  tab: the modal opens over Home; Escape closes it; on an iPhone (and a Home Screen install) scroll the page and tap ✕.

#### Scenario: Shared link
- GIVEN a link to `/title/24194`
- WHEN opened in a fresh tab
- THEN Breaking Bad's details show in the modal

### TITLE-002: Play, Resume and Restart
The system SHALL show Play, or "Resume" (with "S1:E3" for series) plus a progress bar with minutes left when there is
saved progress, and a Restart button that starts from the beginning (the first episode for series).

- Verification: test

#### Scenario: Half-watched episode
- GIVEN 10 of 40 minutes watched of S1:E2
- WHEN the modal opens
- THEN the button reads "Resume S1:E2" and "30m left" is shown

### TITLE-003: My List
The system SHALL add and remove titles from My List (newest first), keeping a snapshot so My List renders offline.

- Verification: test

#### Scenario: Toggle
- GIVEN a title in My List
- WHEN ✓ is pressed
- THEN it leaves the list

### TITLE-004: Ratings
The system SHALL let the user rate a title "Not for me", "I like this" or "Love this!", pressing the same rating again
to clear it; disliked titles SHALL be excluded from recommendations.

- Verification: test

#### Scenario: Dislike
- GIVEN the user dislikes a title
- WHEN Top Picks is built
- THEN that title is absent

### TITLE-005: Details
The system SHALL show match %, year, age rating, seasons (series) or runtime (movies), HD badge, synopsis, cast (top 6),
director(s), genres, IMDb score and an IMDb link, in the chosen titles language.

- Verification: test

#### Scenario: Movie runtime
- GIVEN a duration of 6781 seconds
- WHEN shown
- THEN it reads "1h 53m"

### TITLE-006: Trailer in the hero
The system SHALL show the title's still image first in the hero and, once it has loaded and ~1.8 s have passed, fade a
muted, looping, control-less `youtube-nocookie.com` trailer in over it (no separate trailer section or button), with a
round mute/unmute button in the hero's corner. It SHALL NOT mount the embed before the delay, SHALL unload it when the
modal closes or Play opens the player, pause it while the tab is hidden, and keep the photo (never autoplay) with Reduce
Motion, Data Saver, the "Autoplay previews and trailers" setting off, or no trailer. A failing embed leaves the photo.

- Verification: test

#### Scenario: Watch link
- GIVEN `trailer: https://www.youtube.com/watch?v=7YpuMymmiJ8`
- WHEN the photo has been shown for the delay
- THEN `https://www.youtube-nocookie.com/embed/7YpuMymmiJ8` plays muted over it

### TITLE-007: Episodes
The system SHALL list a series' episodes per season (season selector), each with number, thumbnail, length, synopsis,
progress bar and a ✓ when watched, starting on the season being watched.

- Verification: test

#### Scenario: Several seasons
- GIVEN a series with seasons 1–5
- WHEN the modal opens
- THEN the selector lists Season 1 to Season 5

### TITLE-008: More Like This
The system SHALL show up to 12 titles of the same kind from the title's first known genre (Drama when none),
excluding the title itself.

- Verification: test

#### Scenario: Crime series
- GIVEN a series with genres Musical, Crime
- WHEN More Like This loads
- THEN it lists Crime series

### TITLE-009: Family filter on deep links
The system SHALL show "Not available with your family filter" instead of a title whose rating exceeds the current
level (API-011).

- Verification: manual — set Settings → Family filter to Kids, open `/title/24194` (TV-MA): the modal shows the
  message and no Play button.

#### Scenario: Kids level
- GIVEN the kids level
- WHEN an R-rated movie is deep-linked
- THEN it cannot be played
