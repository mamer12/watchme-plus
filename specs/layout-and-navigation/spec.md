# Layout and navigation

## Purpose

Netflix-like chrome on every screen size, keyboard and TV-remote friendly. Code: `src/components/Layout.tsx`,
`src/lib/spatialNav.ts`, `src/styles/`, `vercel.json`.

## Requirements

### NAV-001: Mobile chrome
The system SHALL, below 800px, show a top bar with the WATCHME+ logo and Search (with Series/Movies chips on browse
pages) that turns solid and blurred on scroll, and a bottom tab bar: Home, New & Hot, Search, My List, Settings.

- Verification: manual — at 390px width: the tab bar is fixed at the bottom above the safe area; the top bar stays.

#### Scenario: Phone
- GIVEN a 390px-wide screen
- WHEN Home opens
- THEN the bottom tab bar shows five tabs with Home active

### NAV-002: Desktop nav
The system SHALL, from 800px, show a top nav (logo, Home, Series, Movies, New & Popular, My List, Search, Settings)
over a gradient that turns solid #141414 once the page scrolls.

- Verification: manual — on desktop scroll Home: the nav background becomes solid.

#### Scenario: Scroll
- GIVEN the top of Home
- WHEN the page scrolls down
- THEN the nav turns solid

### NAV-003: Arrow-key navigation
The system SHALL move focus with the arrow keys to the nearest focusable element in that direction (staying on the
same row when possible) for TV remotes and keyboards, leaving arrows to the player and text inputs.

- Verification: test

#### Scenario: Next card
- GIVEN focus on a card in a row
- WHEN → is pressed
- THEN focus moves to the next card in that row

### NAV-004: Focus and accessibility
The system SHALL show a clear focus outline for keyboard/remote users, offer a skip link, label icon buttons, and use
`dir="auto"` for titles and synopses so Arabic renders right-to-left.

- Verification: manual — Tab through Home: every control shows a white outline; screen readers read button names;
  Arabic titles are right-aligned.

#### Scenario: Arabic title
- GIVEN an Arabic title
- WHEN shown on a card
- THEN it reads right-to-left

### NAV-005: Reduced motion
The system SHALL turn off animations and autoplay previews when the user prefers reduced motion.

- Verification: manual — enable "Reduce motion" in the OS: no slide/fade animations, no billboard preview.

#### Scenario: Reduce motion
- GIVEN prefers-reduced-motion
- WHEN Home opens
- THEN the billboard shows a still image only

### NAV-006: No layout shift
The system SHALL reserve space for images (fixed aspect ratios) and show skeletons while loading.

- Verification: manual — Lighthouse CLS stays below 0.1 on Home.

#### Scenario: Slow network
- GIVEN a slow connection
- WHEN rows load
- THEN skeleton cards hold the layout

### NAV-007: SPA routing on Vercel
The system SHALL rewrite every path except `/api/*` and `/assets/*` (and existing static files) to `/index.html`.

- Verification: test

#### Scenario: Deep link
- GIVEN `https://<app>/title/123`
- WHEN requested
- THEN `index.html` is served and the app opens the title
