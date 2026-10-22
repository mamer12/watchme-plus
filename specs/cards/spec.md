# Cards and box art

## Purpose

Title cards that look like Netflix's: 16:9 box art on desktop, portrait posters on phones, and an expanding hover
card on desktop. Code: `src/components/TitleCard.tsx`, `BoxArt.tsx`, `boxArt.ts`, `HoverCard.tsx`, `Top10Row.tsx`.

## Requirements

### CARD-001: Box art
The system SHALL draw desktop cards as 16:9 box art: the catalog's wide cover when the title has one, else TMDB's
textless backdrop with the title's logo (English or Arabic per the titles-language setting) overlaid bottom-left, else
the poster with the title as text; a backdrop that fails to load falls back to the poster.

- Verification: test
- Depends on: TMDB-005

#### Scenario: No TMDB
- GIVEN TMDB is unavailable
- WHEN a card renders
- THEN it shows the poster cropped to 16:9 with the title written on it

### CARD-002: Lazy art, stable layout
The system SHALL fetch TMDB art only when a card is within ~600px of the viewport, load images lazily, and keep a
fixed aspect-ratio box so nothing shifts while loading.

- Verification: manual — throttle the network, scroll Home: rows keep their size, images fade in, and the network
  panel shows `/api/tmdb` calls only for rows near the screen.

#### Scenario: Below the fold
- GIVEN a genre row far below the screen
- WHEN Home loads
- THEN no art is requested for it

### CARD-003: Hover card
The system SHALL, on desktop with a mouse, expand a card after ~400 ms into a larger card with Play, My List (+/✓),
rate (thumb → dislike/like/love), More Info (⌄), age badge, length or seasons, HD badge and genres; it closes on mouse leave
(a slip of under ~180 ms does not close it), Escape or row scroll. About 0.6 s after it opens (so ~1 s of hovering) its still
image is covered by the title's trailer (a muted `youtube-nocookie.com` embed) which keeps playing while the pointer stays and
is unloaded when the card closes. Only the Settings "Autoplay previews and trailers" switch, Reduce Motion, Data Saver,
touch-only devices and a missing trailer turn the trailer off; the provider choice does not (trailers are not mirror media).

- Verification: manual — hover a card for half a second and check every control; after a second the trailer plays; move away and it closes.

#### Scenario: Quick pass
- GIVEN the mouse crosses a row quickly
- WHEN no card is hovered for 400 ms
- THEN no hover card opens

### CARD-004: No match percentage
The system SHALL NOT show a "% Match" on cards, the billboard or the title page (the user found it distracting; the TV
app doesn't show it either). Ratings still shape the rows (HOME-005, HOME-006).

- Verification: manual — hover a card, open the billboard and a title page: no "% Match" anywhere.

#### Scenario: Title page
- GIVEN any title
- WHEN its page opens
- THEN the facts line starts with the year

### CARD-005: Top 10 cards
The system SHALL draw Top 10 items as a large outlined numeral (1–10) next to a portrait poster.

- Verification: manual — with a TMDB key, check the Top 10 rows: numerals are outlined, the poster overlaps them
  slightly, "10" fits.

#### Scenario: Rank 10
- GIVEN the tenth title
- WHEN drawn
- THEN the two-digit numeral fits beside the poster

### PERF-004: Smallest suitable image
The system SHALL use the small poster (`poster_medium_thumb`, about 30 KB) for cards, rows, Top 10, search and
onboarding, falling back to the full poster only if it fails, and the wide cover (about 300 KB) only for the billboard
and the title page. On the mirror, cards of banner titles use the small poster instead of the cover.

- Verification: test
- Depends on: `src/lib/imageVariant.ts`

#### Scenario: Row card
- GIVEN a title with a medium thumbnail
- WHEN its card renders
- THEN the thumbnail is requested, not the full poster

### PERF-005: Few images at a time
The system SHALL load lazy images only once they are near the viewport, at most 8 at a time (4 on the mirror), in the
order they came into view, and load one billboard cover at a time with `fetchpriority="high"` on the first only.

- Verification: test
- Depends on: `src/components/Img.tsx`

#### Scenario: Fast scroll
- GIVEN 20 cards come into view at once on the mirror
- WHEN they start loading
- THEN no more than 4 downloads are active

### PERF-006: Stable boxes
The system SHALL give images explicit width and height, `decoding="async"` and a dark placeholder until they fade in.

- Verification: manual — throttle the network and scroll Home: boxes keep their size, a dark block shows, images fade in.

#### Scenario: Slow image
- GIVEN a slow image host
- WHEN a card is on screen
- THEN a dark box of the final size shows until the image arrives
