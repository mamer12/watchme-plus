# Profiles

## Purpose

Netflix-style "Who's watching?": up to six profiles on one device (and one sync space), each with its own My List,
ratings, progress, taste and viewing preferences. Kids profiles are locked to the family filter and have no settings.
The TV app implements the same model in Java, so the profile record and the sync keys below must stay compatible.
Code: `src/profiles/` (pure rules, store, UI), `src/state/store.ts` (per-profile library), `src/sync/keys.ts`,
`src/sync/mapping.ts`, `src/sync/merge.ts`, `src/sync/profilesRow.ts`.

Profile record: `{id, name (1-20), color (0-7), avatar (one of 12), kids, pin: null | {salt, iter: 20000, hash}, order, created}`.
`id` is `main` for the first (legacy) profile, else 8 random characters from a-z0-9. Device-global, never per profile:
provider, quality and quality cap, previews autoplay, volume and mute, parallel fetch, sync credentials.

## Requirements

### PRF-001: First run migrates everything into "main"
The system SHALL create a profile `main` named "Me" when none exists and SHALL give it the library that was already saved
(My List, progress, ratings, taste, viewing preferences) without rewriting it; the device-global settings found in that
library SHALL become the device's own.

- Verification: test

#### Scenario: An existing library
- GIVEN a saved library with a My List and quality 720p, and no profiles
- WHEN the app starts
- THEN the only profile is `main` named "Me", its library holds that My List, and quality 720p is the device setting

### PRF-002: Profiles do not share per-profile data
The system SHALL keep My List, ratings, progress, taste and the nine synced viewing preferences separately per profile,
switch between them without a page reload, and share the device-global settings (quality, volume, previews) across all.

- Verification: test
- Verification: manual — create a second profile, add a title to its My List, switch back: the first profile's list is unchanged.

#### Scenario: Switching
- GIVEN profile A has a title in My List and profile B has none
- WHEN B is opened
- THEN My List is empty, and A's title is back when A is opened again

### PRF-003: Kids profiles are locked
The system SHALL, while a Kids profile is open, force the family filter level 2 and "skip flagged scenes" on whatever
changes or syncs in, and SHALL give it no Settings, Sync, Reset or profile management.

- Verification: test
- Verification: manual — open a Kids profile: no gear in the nav or tab bar, /settings goes home, the menu has no Manage profiles.

#### Scenario: Trying to lower the filter
- GIVEN a Kids profile is open
- WHEN something sets the family filter to 0 and flagged-scene skipping off
- THEN they are level 2 and on

### PRF-004: PINs are hashed
The system SHALL store a PIN (4 to 6 digits) only as `{salt: base64(16 bytes), iter: 20000, hash: base64(PBKDF2-HMAC-SHA256, 32 bytes)}`
made with Web Crypto, compare it in constant time, and reject anything that is not 4 to 6 digits.

- Verification: test
- Depends on: Web Crypto (injectable in tests)

#### Scenario: Setting and checking
- GIVEN a PIN 4821 is set
- WHEN 4821 and 4822 are checked
- THEN the first matches, the second does not, and the record holds no digits of the PIN

### PRF-005: Five wrong tries lock for five minutes
The system SHALL refuse further tries for 5 minutes after the fifth wrong PIN in a row, keep that lock across reloads,
and clear the count after a correct PIN.

- Verification: test

#### Scenario: Fifth wrong try
- GIVEN four wrong tries
- WHEN a fifth wrong PIN is entered
- THEN further tries (even the right PIN) are refused until 5 minutes have passed, also after a reload

### PRF-006: PINs guard entering, leaving Kids and management
The system SHALL ask for a profile's PIN to enter it, and SHALL ask for the PIN of an adult profile that has one to leave
a Kids profile or to open profile management; when no adult profile has a PIN it SHALL NOT ask.

- Verification: test
- Verification: manual — set a PIN on an adult profile, open Kids, choose Switch profile: the PIN pad appears; the on-screen keys, the keyboard digits and the arrows all work.

#### Scenario: No adult PIN
- GIVEN no adult profile has a PIN
- WHEN someone leaves a Kids profile
- THEN no PIN is asked

### PRF-007: Limits and validation
The system SHALL allow at most 6 profiles, names of 1 to 20 characters, colours 0 to 7 and the 12 known avatars, keep at
least one profile, and give new profiles an id of 8 random lowercase letters and digits that is never reused.

- Verification: test

#### Scenario: A seventh profile
- GIVEN six profiles
- WHEN another is added
- THEN it is refused

### PRF-008: "Who's watching?" at start
The system SHALL show the picker on start when there is more than one profile and "Ask on every start" is on (the default),
or when the profile to reopen has a PIN; otherwise it SHALL reopen the profile this device used last.

- Verification: test
- Verification: manual — with two profiles the picker covers the screen on load; with "Ask on every start" off the last profile opens.

#### Scenario: Ask turned off
- GIVEN two profiles, "Ask on every start" off, the last used was B without a PIN
- WHEN the app starts
- THEN B opens and no picker is shown

### PRF-009: Sync keys are prefixed by profile
The system SHALL key every per-profile sync row `<profileId>~<oldKey>` (watch progress `item_key`, My List and ratings
`title_id`) and settings rows `pref:<profileId>:<name>`, and SHALL only send the nine shared preferences.

- Verification: test

#### Scenario: A rating in profile k3x9
- GIVEN profile k3x9 rates title 10
- WHEN the change is queued
- THEN the row's `title_id` is `k3x9~10`

### PRF-010: Old keys belong to "main"
The system SHALL read sync rows without a prefix as belonging to profile `main`, ignore deleted old rows, apply only the
open profile's rows, and, when `main` writes a key that exists un-prefixed on the server, also tombstone the old key.

- Verification: test

#### Scenario: A row from before profiles
- GIVEN the server has `v:10` written before profiles existed
- WHEN `main` is open
- THEN it is applied to `main`; when another profile is open it is ignored

### PRF-011: The profile list is one synced row
The system SHALL sync the list (with PIN hashes) as one settings row `profiles` where the newest change wins unless a newer
local change is queued, keep a tombstone `{id, deleted: true}` for deleted profiles, and refuse a list with no profile.

- Verification: test

#### Scenario: Deleting a profile
- GIVEN three profiles
- WHEN one is deleted
- THEN the list keeps `{id, deleted: true}` for it, and another device drops it when it syncs

### PRF-012: Switching does not read as an edit
The system SHALL treat swapping the library for another profile's as no change to sync, pull the rows of the profile
that opened, and, on deleting a profile with "also delete its synced data", queue tombstones for its rows.

- Verification: test

#### Scenario: Switch
- GIVEN profile A is open with nothing queued
- WHEN profile B (with its own My List) opens
- THEN nothing is queued

### PRF-013: Reset clears profiles on this device only
The system SHALL remove the profile list, every profile's library, the device settings and PIN locks from the browser on
"Reset this site", and SHALL NOT touch what is on the sync service.

- Verification: test

#### Scenario: Reset
- GIVEN two profiles with libraries and a PIN lock
- WHEN the site is reset
- THEN none of their keys remain

### PRF-014: Picker, nav menu and management screens
The system SHALL show round avatar tiles with names, a Manage mode (add and edit name, colour, avatar, Kids, PIN; delete
with a confirmation and "also delete its synced data"), and the active profile's avatar top-right with Switch profile and
Manage profiles; all of it SHALL be reachable with keyboard and TV remote.

- Verification: manual — run the app: create a second profile with a PIN, switch to it, check My List is separate, make a Kids profile, confirm Settings is gone, delete it.

#### Scenario: Managing
- GIVEN the picker is open
- WHEN Manage profiles is chosen
- THEN tiles become editable and an Add profile tile appears (up to 6)
