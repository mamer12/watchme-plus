# Provider (Automatic connection)

## Purpose

Pick the catalog server that works on the viewer's network without asking: EarthLink (EL) first, Albox when configured,
else the mirror ("other"). Code: `src/api/endpoints.ts` (registry), `src/api/detect.ts` (probing),
`src/api/provider.ts` (when to detect and switch), `src/api/switchIsp.ts` (cache clearing).

## Requirements

### PROV-001: Provider registry
The system SHALL keep every provider in one ordered registry in `src/api/endpoints.ts` (the only place hostnames are
written): EL, then Albox, then the mirror, whose id stays `other` so stored `wmp:isp` values stay valid. A provider
without a hostname or not enabled (Albox until configured) SHALL never be probed, stored or used. Turning Albox on is a
one-line edit of its registry entry.

- Verification: test
- Depends on: `PROVIDERS`

#### Scenario: Albox not configured
- GIVEN Albox has no hostname
- WHEN detection runs
- THEN only EL and the mirror are probed

### PROV-002: Probe
The system SHALL probe a provider with `GET https://<host>/api/android/mainCategories?lang=en` (cors, no-store), give up
after 3.5 s with an AbortController, and count an HTTP error, a network error or a body that is not a JSON array as a failure.

- Verification: test

#### Scenario: Block page
- GIVEN a provider answers 200 with HTML
- WHEN it is probed
- THEN the probe fails

### PROV-003: Priority pick
The system SHALL probe all usable providers in parallel and use the highest-priority one that answers: at once when the
top one answers, otherwise the best answer 1.5 s after the first success, or sooner when every higher-priority provider has failed.

- Verification: test

#### Scenario: EL slow
- GIVEN EL answers after 1.2 s and the mirror after 0.1 s
- WHEN detection runs
- THEN EL is picked

#### Scenario: EL down
- GIVEN EL times out and the mirror answers
- WHEN detection runs
- THEN the mirror is picked

### PROV-004: Nothing answers
The system SHALL keep the last known provider (the mirror when none is known, for this session only) when no provider
answers, retry detection after 2 s, 6 s and 15 s, and again when the browser fires `online`.

- Verification: test

#### Scenario: Offline start
- GIVEN no provider answers
- WHEN 2 s, 8 s and 23 s have passed
- THEN detection has run three more times and the stored provider is unchanged

### PROV-005: Every start re-checks
The system SHALL start from the cached provider at once, and on every cold start (and when a tab returns after more than
30 min hidden, and on `online`) run a silent detection round: it switches only when the cached provider fails and another
passes, or when a higher-priority provider passes while a lower one is active, at most once per 60 s. The `wmp:isp:checked`
timestamp SHALL only decide the "Finding the best connection..." splash, shown when no provider is cached or the answer is
older than 24 h, and never for longer than 4 s.

- Verification: test
- Depends on: `wmp:isp`, `wmp:isp:checked`

#### Scenario: EL back
- GIVEN the mirror was cached an hour ago and EL answers now
- WHEN the app opens
- THEN it starts on the mirror without a splash and moves to EL when the round ends

### PROV-006: Failure switch and rate limit
The system SHALL, after two catalog requests in a row fail with a network error on the active provider, run detection
at once and switch without any banner, clearing provider-keyed caches. Automatic switches SHALL happen at most once per
60 s. The Settings "Re-check" button runs detection now and is not rate-limited.

- Verification: test
- Depends on: ISP-005, ISP-007

#### Scenario: Flapping
- GIVEN the app just switched to the mirror and EL is back
- WHEN two requests fail within 60 s
- THEN it stays on the mirror

### PROV-007: URL override
The system SHALL accept `?isp=el|albox|other` (usable providers only) as a troubleshooting override that stores the
choice and turns automatic detection and switching off for the session.

- Verification: test

#### Scenario: Forced mirror
- GIVEN the address has `?isp=other`
- WHEN the app starts
- THEN the mirror is used and nothing is probed

### PROV-008: Unknown stored id
The system SHALL treat a stored provider id that is unknown or not usable as nothing stored and detect again.

- Verification: test

#### Scenario: Old value
- GIVEN `wmp:isp` holds a retired id
- WHEN the app starts
- THEN the splash shows and detection picks a provider

### PROV-009: Everything follows the detected provider
The system SHALL read the active provider for the API base, image host rewriting (any catalog image host maps to the
active provider's), connection hints, parallel range fetching (and tell the service worker on every change), adaptive
start quality, the lighter artwork and the mirror media preview rule; the service worker routes SHALL cover every usable provider.

- Verification: test
- Depends on: PERF-008, PERF-013

#### Scenario: Mirror active
- GIVEN the active provider is the mirror
- WHEN a stored artwork link from another catalog host is shown
- THEN it loads from the mirror's image host

### PROV-010: No manual choice
The system SHALL have no provider step in onboarding and no connection banner. Settings → Connection SHALL show
"Connected through: <provider>" read-only, a "Re-check" button and a hint that it is automatic.

- Verification: manual — clear site data: the splash shows briefly, then onboarding starts at "What do you like to watch?"; Settings → Connection shows the provider and Re-check works.

#### Scenario: Re-check
- GIVEN Settings is open
- WHEN the person presses Re-check
- THEN detection runs and the line shows the provider in use
