# Sync

## Purpose

Cross-device sync without accounts. Each browser signs in anonymously to a Supabase project, creates a private "space" or
joins one with an 8-character pairing code, and the library (watch progress, My List, ratings, viewing preferences)
follows the person (per profile, see `specs/profiles/spec.md`: rows are keyed `<profileId>~<key>`, the profile list is the settings row `profiles`). Local first: the app never waits for the network. Backend: `supabase/README.md`.
Code: `src/sync/` (pure engine, merge and mapping; `service.ts` is the browser wiring), `src/sync/SyncSection.tsx` (Settings).

## Requirements

### SYNC-001: Hidden without configuration
The system SHALL show no Sync controls and run no sync code unless both `VITE_SUPABASE_URL` (an https URL) and
`VITE_SUPABASE_ANON_KEY` are set at build time.

- Verification: test
- Depends on: `src/sync/config.ts`

#### Scenario: Missing key
- GIVEN the URL is set but the anon key is empty
- WHEN the app starts
- THEN sync is disabled and Settings has no Sync section

### SYNC-002: Pairing code input is forgiving
The system SHALL accept a pairing code typed in any case, with spaces or dashes, and compare only its 8 letters and
digits; it SHALL show a friendly message for a wrong, expired or rate-limited code.

- Verification: test

#### Scenario: Typed with a dash
- GIVEN the person types "k7m2-qx4p "
- WHEN the code is normalised
- THEN it is "K7M2QX4P"

### SYNC-003: Join links
The system SHALL read a code from `?join=CODE` and build join links as `https://watch-me-plus.vercel.app/?join=CODE`;
opening one SHALL ask for confirmation before joining, and a missing or incomplete code SHALL be ignored.

- Verification: test
- Verification: manual — open `/?join=<fresh code>` on a second browser: the "Join sync?" dialog appears with Cancel
  focused; Join links the device; Cancel leaves it unlinked and removes `join` from the address.

#### Scenario: Incomplete code
- GIVEN the address has `?join=K7M2`
- WHEN the app starts
- THEN nothing is asked

### SYNC-004: Default device name
The system SHALL propose a device name from the user agent ("Chrome on Windows", "Phone", "Tablet", "TV").

- Verification: test

#### Scenario: A phone
- GIVEN an iPhone user agent
- WHEN the name is proposed
- THEN it is "Phone"

### SYNC-005: Newest change wins
The system SHALL apply a row from the server to the library unless this device has a newer change for the same item still
queued; a device SHALL ignore rows it wrote itself.

- Verification: test

#### Scenario: Local change is newer
- GIVEN a rating changed here at 10:05 and not yet sent
- WHEN a row for the same title written at 10:00 arrives
- THEN the local rating is kept

### SYNC-006: Tombstones and the union of lists
The system SHALL remove a My List item when a tombstone arrives, add remote items to the front of the list, and on the first
link SHALL keep titles that exist only on this device (union).

- Verification: test

#### Scenario: Removed elsewhere
- GIVEN title 5 is in My List here
- WHEN a deleted row for title 5 arrives
- THEN it leaves My List

### SYNC-007: Remote progress and Continue Watching
The system SHALL apply remote watch progress (including a series' current episode), show on Continue Watching which other
device the newest position came from, and SHALL NOT move the position of the video that is playing on this device.

- Verification: test
- Depends on: HOME-003, PLAYER-010

#### Scenario: Continued from the phone
- GIVEN the phone saved 20 minutes of a movie
- WHEN this device pulls
- THEN Continue Watching lists it at 20 minutes marked "from Phone", and Play resumes there

### SYNC-008: Outbox survives reloads and is coalesced
The system SHALL queue every local change in a persisted outbox, keep only the newest queued change per item, and send
what is left after a reload or after being offline.

- Verification: test

#### Scenario: Closed while offline
- GIVEN a rating changed with no network and the tab closed
- WHEN the app opens again with a network
- THEN the rating is sent

### SYNC-009: Retry with backoff
The system SHALL retry failed syncs after 2 s, 4 s, 8 s and so on up to 5 minutes, report "Offline, will sync later" when
there is no network and "Error, retrying" otherwise, and SHALL never throw to the user or block the UI.

- Verification: test

#### Scenario: Server error
- GIVEN the server answers 500
- WHEN a change is pushed
- THEN the status is error and the next attempt comes about 2 s later, then 4 s

### SYNC-010: Progress push is throttled
The system SHALL send watch progress at most once every 15 s while playing, and immediately on pause, seek, end, leaving the
player and when the page is hidden or closing (a keepalive request).

- Verification: test

#### Scenario: Five-second saves
- GIVEN progress is saved every 5 s for 45 s
- WHEN the pushes are counted
- THEN there are at most four and none closer than 15 s

### SYNC-011: Only shared preferences sync
The system SHALL sync only: family filter, title language, skip flagged scenes, autoplay next, and the subtitle language, size,
color, background and offset. Quality, highest automatic quality, preview autoplay, volume and mute SHALL stay on the device.

- Verification: test

#### Scenario: Quality cap
- GIVEN the highest automatic quality is changed
- WHEN changes are queued
- THEN nothing for it is queued

### SYNC-012: Writes carry the time of the change
The system SHALL send every write with `client_ts` set to when the change was made, so an old offline replay loses to a newer
change on the server.

- Verification: test

#### Scenario: Replay after a day offline
- GIVEN a rating queued at 09:00
- WHEN it is sent at 21:00
- THEN its `client_ts` is 09:00

### SYNC-013: First link and first-sync message
The system SHALL upload what is already on the device when it links, pull before sending so anything newer on the server wins,
and show one message ("Synced 12 items from TV") when the first sync has brought items in.

- Verification: test

#### Scenario: Joining a space
- GIVEN the space holds 12 items from "TV"
- WHEN this device joins
- THEN once the first sync ends a toast says "Synced 12 items from TV"

### SYNC-014: Pulling
The system SHALL pull changes per table since the last cursor when sync starts, when the network returns, when the tab becomes
visible and every 60 s while visible, and SHALL apply realtime changes immediately when the browser supports them.

- Verification: test

#### Scenario: Coming back to the tab
- GIVEN the tab was hidden
- WHEN it becomes visible
- THEN a pull runs, starting at the stored cursor

### SYNC-015: Anonymous session handling
The system SHALL sign in anonymously once, refresh the session before it expires, store the refresh token durably, and SHALL
NOT create a new anonymous account when a session is lost while linked.

- Verification: test

#### Scenario: Expired access token
- GIVEN the access token is about to expire
- WHEN a request is made
- THEN the session is refreshed first and the new tokens are saved

### SYNC-016: Reset signs out of sync
The system SHALL, on Reset this site, stop syncing and forget the sync session first, without deleting server data, and the
reset dialog SHALL say so.

- Verification: test

#### Scenario: Reset while linked
- GIVEN the device is linked
- WHEN the site is reset
- THEN the sync step runs before storage is cleared and no request is sent

### SYNC-017: Realtime messages
The system SHALL turn backend realtime frames into row changes and ignore anything else.

- Verification: test

#### Scenario: A heartbeat reply
- GIVEN a frame that is not a postgres_changes event
- WHEN it is parsed
- THEN it is ignored

### SYNC-018: Settings, Sync section
The system SHALL offer in Settings, when sync is configured: Start syncing and Join with a code (not linked); and, when
linked, a status chip (Synced just now, Offline will sync later, Error retrying), the device list with this device marked, Add
another device (large code, 10-minute countdown, QR code), Disconnect this device (keeps local data) and Delete all synced
data (confirmation, Cancel focused).

- Verification: manual — with the VITE_ values set: start syncing, add a device and see the code, countdown and QR; join
  from a second browser; Disconnect; Delete all synced data shows the dialog with Cancel focused.

#### Scenario: Linked
- GIVEN the device is linked
- WHEN Settings opens
- THEN the device list shows this device marked "(this device)" and the chip says "Synced just now"
