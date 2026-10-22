# Settings

## Purpose

One user, no accounts: every preference is stored in this browser (`localStorage`, key `wmp:state:v1`).
Code: `src/features/settings/SettingsPage.tsx`, `src/state/`.

## Requirements

### SET-001: Family filter
The system SHALL offer a family filter (All titles = level 0, Family = level 2, Kids = level 3) that applies to every
the catalog request (API-010) and to the client-side guard (API-011), reloading rows when changed.

- Verification: test

#### Scenario: Switch to Kids
- GIVEN the filter is set to Kids
- WHEN Home reloads
- THEN every request uses level 3

### SET-002: Subtitle defaults and style
The system SHALL let the user choose the default subtitles (Arabic, English, Off), size (small, medium, large), color
(white, yellow, cyan), background (drop shadow, dark box, none) and timing offset, with a live preview.

- Verification: manual — change each subtitle option in Settings: the preview updates, and the next video uses them.

#### Scenario: Yellow in a box
- GIVEN color yellow and background box
- WHEN subtitles show in the player
- THEN they are yellow on a dark box

### SET-003: Preview autoplay
The system SHALL let the user turn billboard previews off (HOME-002).

- Verification: test

#### Scenario: Off
- GIVEN previews are off
- WHEN Home stays open on desktop
- THEN no preview plays

### SET-004: Autoplay next episode
The system SHALL let the user turn off the automatic next episode (PLAYER-009).

- Verification: manual — turn it off, reach the credits: Next Episode shows without the countdown fill and nothing
  plays by itself.

#### Scenario: Off
- GIVEN autoplay next is off
- WHEN an episode ends
- THEN the Up Next screen waits for the user

### SET-005: Titles language
The system SHALL show titles, synopses, genres and TMDB logos in English or Arabic, falling back to the other language
when one is missing.

- Verification: test

#### Scenario: Arabic
- GIVEN Arabic is chosen and a title has `ar_title`
- WHEN cards render
- THEN the Arabic title shows

### SET-006: Clear history
The system SHALL clear watch history (Continue Watching and resume points) after confirmation, keeping My List and
ratings.

- Verification: test

#### Scenario: Clear
- GIVEN progress on two titles
- WHEN history is cleared
- THEN Continue Watching is empty and My List is unchanged

### SET-007: Persistence
The system SHALL save the library (settings, My List, ratings, progress, onboarding) in localStorage, restore it with
defaults for new settings, discard malformed data, and sync changes made in another tab.

- Verification: test

#### Scenario: Old save without a new setting
- GIVEN a saved state that lacks `autoplayNext`
- WHEN the app starts
- THEN `autoplayNext` takes its default and the rest is restored

### SET-008: Connection
The system SHALL show a read-only "Connected through: <provider>" line in Settings → Connection, a "Re-check" button
that runs provider detection now, and a hint that the choice is automatic (see PROV-006, PROV-010).

- Verification: manual — Settings → Connection shows EarthLink (EL) or Other networks (mirror); Re-check shows "Checking…" then the result.
- Depends on: PROV-005, PROV-006

#### Scenario: Re-check
- GIVEN Settings is open
- WHEN the person presses Re-check
- THEN detection runs and the data reloads if the provider changed

### SET-009: Reset this site
The system SHALL offer a danger-styled "Reset this site" row at the bottom of Settings which, after a confirmation
dialog (listing My List, ratings, watch progress, settings and cached images; Cancel focused by default), deletes
localStorage, sessionStorage, IndexedDB databases, Cache Storage, the site's cookies (on the current and parent paths)
and service worker registrations, continuing past any step that fails and reporting which failed, then reloads once
into the first-run onboarding. Missing browser APIs SHALL be skipped.

- Verification: test
- Depends on: SET-007

#### Scenario: Reset
- GIVEN My List entries, ratings and a cache exist
- WHEN the user confirms "Reset this site"
- THEN all stored data is gone and the app restarts on the onboarding

#### Scenario: One step fails
- GIVEN clearing Cache Storage throws
- WHEN the reset runs
- THEN the other steps still run, the failure is reported, and the page reloads
