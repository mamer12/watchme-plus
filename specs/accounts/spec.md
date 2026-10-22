# Accounts

## Purpose

Netflix-like accounts on top of sync: sign in with the same email and password on every device and the profiles and each
profile's progress, My List and ratings follow automatically, with no pairing. A **guest** is the anonymous session
(a private space, no email, still works); an **account** is an email + password on the same kind of user. The TV app
implements the same flows in Java. Code: `src/sync/accounts.ts` (rules and flows), `src/sync/Welcome.tsx`,
`src/sync/AccountSection.tsx`, `src/sync/recovery.ts`; backend: `supabase/migrations/0002_accounts.sql`,
`supabase/README.md` (owner steps).

## Requirements

### ACC-001: A guest becomes an account in place
The system SHALL turn a device's guest session into an account with `PUT /auth/v1/user {email, password}`, keeping the
same user, space and data, and SHALL NOT sign up a second user or start a second space.

- Verification: test
- Depends on: `SyncClient.updateUser`, `AccountService.createAccount`

#### Scenario: Upgrade
- GIVEN a linked guest device
- WHEN the person creates an account with a valid email and password
- THEN the existing session is updated, no sign-up happens, the account email is stored and sync keeps its space

### ACC-002: Create an account with no session
The system SHALL create an account with `POST /auth/v1/signup {email, password}` when the device has no session, then call
`create_space(device_name)` and start syncing, and SHALL say "check your email" when the project requires confirmation.

- Verification: test

#### Scenario: Fresh device
- GIVEN a device with no session
- WHEN the person creates an account
- THEN the account is signed up, a space is created and linked, and the email is stored

### ACC-003: Sign in on any device
The system SHALL sign in with `POST /auth/v1/token?grant_type=password`, store the access and refresh tokens like the guest
session, call `create_space(device_name)` (which returns the user's existing space) and start syncing.

- Verification: test

#### Scenario: Second device
- GIVEN an account with data and a new device
- WHEN the person signs in
- THEN the new device uses the account's session and space and pulls the library

### ACC-004: Sign out removes this device's copy
The system SHALL, after a confirmation that says "Your data stays in your account", end the session on the server for this
device only, remove its per-profile libraries, profile list, outbox, cursors and tokens, and show the welcome screen on
the next start.

- Verification: test
- Verification: manual — Settings, Account, Sign out: the dialog says the data stays in the account; after confirming the welcome screen appears

#### Scenario: Sign out
- GIVEN a signed-in device with a library
- WHEN the person confirms Sign out
- THEN the server session is ended, the library, profiles and sync state are gone locally and device settings stay

### ACC-005: Signing in on a device that has its own data
The system SHALL, when the device has data of its own, ask "Add this device's data to your account?" before switching: Add
it merges (My List union, newest progress wins, profile lists joined), Skip uses only the account's data, Cancel changes
nothing. The old guest space SHALL be left so no orphan data remains. With no local data it SHALL NOT ask.

- Verification: test

#### Scenario: Guest with data signs in
- GIVEN a guest device with a My List and a different existing account
- WHEN the person signs in and chooses Add it
- THEN the guest space is left, the account's space is joined and the local data is uploaded into it

#### Scenario: Skip
- GIVEN the same device
- WHEN the person chooses Skip
- THEN this device's library is removed and the next start pulls the account's data

### ACC-006: Profile lists join
The system SHALL join two profile lists by id: a profile on both sides takes the account's version (so a guest's `main` merges
into the account's `main`), a deletion on either side stays, and a profile only one side has is kept.

- Verification: test

#### Scenario: Union
- GIVEN a guest list with a Kids profile and an account list with a different one
- WHEN they are joined
- THEN both profiles are in the result, once each

### ACC-007: Friendly errors
The system SHALL turn backend errors into short messages (wrong email or password, email already registered, weak
password, bad email, offline, too many tries, confirmation needed) and SHALL NOT show the server's text.

- Verification: test

#### Scenario: Wrong password
- GIVEN the server answers `invalid_credentials`
- WHEN sign-in fails
- THEN the message says the email and password do not match

### ACC-008: Deleting needs the word DELETE
The system SHALL delete an account (`delete_my_account()`, which removes the user, its space and all its data) only after
the exact word DELETE is typed, and SHALL then wipe this device's copy.

- Verification: test
- Verification: manual — Settings, Account, Delete account: the button stays disabled until DELETE is typed

#### Scenario: Wrong word
- GIVEN the dialog is open
- WHEN the person types "delete me"
- THEN nothing is deleted

### ACC-009: Forgot password is optional
The system SHALL show "Forgot password?" and handle the recovery link (`#access_token=…&type=recovery`) with a "Set a new
password" screen only when `VITE_AUTH_RECOVERY=1`, because the backend needs email sending set up for it.

- Verification: test

#### Scenario: Flag off
- GIVEN `VITE_AUTH_RECOVERY` is not 1
- WHEN the sign-in form opens or a recovery link is followed
- THEN there is no forgot link and the link is ignored

### ACC-010: What the app shows first
The system SHALL show the welcome screen (Sign in, Create account, Continue as guest) whenever sync is configured and no
one is signed in, not even a guest; the reset-password screen first when a recovery link was followed; then the profile
picker when there are several profiles; and no new screens when sync is not configured.

- Verification: test
- Verification: manual — a first visit shows the welcome screen; Continue as guest goes straight in and syncing starts

#### Scenario: Signed out
- GIVEN sync is configured and the device is not linked
- WHEN the app starts
- THEN the welcome screen shows

### ACC-011: Passwords are never kept
The system SHALL send a password only in the request body: it SHALL NOT be saved in any storage, written to the console or
included in an error.

- Verification: test

#### Scenario: After sign-in
- GIVEN a successful sign-in
- WHEN the saved state is searched for the password
- THEN it is not there

### ACC-012: Form rules and retry limit
The system SHALL require an email that looks like one and a password of at least 8 characters (twice when creating or
changing), disable the submit button while a request is pending, and wait 1 s, 2 s, 4 s... (up to 30 s) after each failure.

- Verification: test

#### Scenario: Short password
- GIVEN a 7-character password
- WHEN the form is checked
- THEN it says to choose at least 8 characters

### ACC-013: Auth requests
The system SHALL use `POST /auth/v1/token?grant_type=password`, `POST /auth/v1/signup`, `PUT /auth/v1/user`,
`POST /auth/v1/logout?scope=local` (this device only) and `POST /auth/v1/recover`, with the public key only.

- Verification: test

#### Scenario: Sign out is local
- GIVEN a signed-in device
- WHEN it signs out
- THEN the logout request has `scope=local` so other devices stay signed in

### ACC-014: A fresh sign-in shows progress
The system SHALL show "Getting your profiles…" after signing in until the first sync has pulled the profile list and the
active profile's rows, then "Who's watching?" when there are several profiles.

- Verification: manual — sign in on a second browser: the splash shows, then the picker

#### Scenario: Second browser
- GIVEN an account with two profiles
- WHEN the person signs in on a new browser
- THEN "Getting your profiles…" shows, then "Who's watching?"

### ACC-015: Guests keep pairing
The system SHALL keep the pairing code feature for guests as "Link a guest device", hide it (and Disconnect) for accounts,
and show the email (or "Guest") with Sign out, Change password, Delete account and Create account in Settings, Account.

- Verification: manual — Settings as a guest shows Guest, Sign in, Create account; as an account shows the email and no pairing

#### Scenario: Account settings
- GIVEN a signed-in account
- WHEN Settings opens
- THEN the email, Sign out, Change password and Delete account show, and no pairing code

### ACC-016: The backend deletes an account
The backend SHALL provide `delete_my_account()` (security definer, pinned search path, authenticated only) that removes the
caller from all spaces (deleting empty ones and their data) and deletes the auth user.

- Verification: manual — run `supabase/tests/accounts_test.sql` after the migrations: only PASS notices

#### Scenario: Last member deletes
- GIVEN a user who is the only member of a space
- WHEN they call `delete_my_account()`
- THEN the user, the space and its data are gone

### ACC-017: Devices of one account see each other's changes
The system SHALL apply, on every device, the rows written by the same account from another device. A guest (one user per
device) still skips the rows it wrote itself.

- Verification: test

#### Scenario: Two devices, one account
- GIVEN a My List row written by the account's user from the TV
- WHEN the website pulls it while signed in to the same account
- THEN the title appears in the website's My List

### ACC-018: A TV's QR code is captured on landing
The system SHALL read a whole TV code from `/?tv=CODE` or `#tv=CODE` (an 8-character code, spaces, dashes and case tolerated),
keep it in `sessionStorage` only so it survives sign-in and sign-up redirects, and remove it from the address. A partial or
invalid code is ignored. The code is never logged and is forgotten once approved, cancelled or refused.

- Verification: test

#### Scenario: Opening the QR link
- GIVEN the page is opened at `/?tv=ABCD-EFGH&x=1`
- WHEN the app starts
- THEN the code ABCDEFGH is pending, and the address is `/?x=1`

### ACC-019: Approving a TV
The system SHALL, when someone is signed in (an account, or a guest with a space) on an adult profile, show a full-screen
"Sign in your TV?" dialog with the code grouped as ABCD EFGH, who is signing in (the email or "this guest space"), one line
on what happens, and Approve (focused) and Cancel. Approve calls `approve_device_login(code)` and then says
"Your TV is signed in. You can close this."

- Verification: test
- Verification: manual — scan a TV's QR code while signed in: the dialog shows, Approve signs the TV in

#### Scenario: Approve
- GIVEN a signed-in account and a pending TV code
- WHEN the person taps Approve and the backend answers true
- THEN the success message shows and the code is forgotten

### ACC-020: Friendly approval errors
The system SHALL map a false answer to "That code didn't work. Ask the TV for a new QR code." (wrong, expired and used
look the same), `too_many_attempts` to a wait message, a network failure to an offline message, and anything else to a
generic one. Raw server text is never shown.

- Verification: test

#### Scenario: Wrong code
- GIVEN the backend answers false
- WHEN the person approves
- THEN "That code didn't work. Ask the TV for a new QR code." shows

### ACC-021: Signed out, the code waits
The system SHALL, when a TV code is pending and nobody is signed in, show the welcome screen with the line "Sign in to
approve your TV", and show the approval dialog right after sign-in or "Continue as guest" completes.

- Verification: test
- Verification: manual — open `/?tv=CODE` signed out, sign in: the dialog follows

#### Scenario: Code kept through sign-in
- GIVEN a pending TV code and nobody signed in
- WHEN the page reloads after sign-in
- THEN the code is still pending

### ACC-022: Type the TV's code
The system SHALL offer a "Sign in a TV" row in Settings, Account (and Sync for a linked guest) with a code field that
normalises like pairing codes and enables the button only for a whole code, then the same approval dialog.

- Verification: test

#### Scenario: Manual code
- GIVEN the text "abcd efgh"
- WHEN it is normalised
- THEN it is a complete code ABCDEFGH

### ACC-023: Kids profiles cannot sign in a TV
The system SHALL hide the "Sign in a TV" row for Kids profiles and, for a code that arrives while a Kids profile is
active, forget the code and say to use an adult profile.

- Verification: test

#### Scenario: Kids profile
- GIVEN a Kids profile is active
- WHEN the capabilities are read
- THEN signing in a TV is not allowed
