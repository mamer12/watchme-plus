# Watchme+ specifications

Spec-driven development, OpenSpec style: one spec per capability, each a list of requirements that the code and the
tests trace back to. When the implementation changes behaviour, the spec changes in the same commit.

## Conventions

- One folder per capability: `specs/<capability>/spec.md`, with **Purpose** and **Requirements**.
- A requirement is a heading `### PREFIX-NNN: Short name`, followed by one or more sentences with **SHALL**.
  IDs are stable: never renumber; retire an ID by deleting the requirement, never reuse it.
- Each requirement has at least one `#### Scenario:` written as `- GIVEN` / `- WHEN` / `- THEN`.
- `- Verification: test` means a Vitest test name contains the ID, e.g. `it('PLAYER-007: shows Skip Intro …')`.
  `- Verification: manual — <check>` means it is checked by hand (UI, layout, devices) and says how.
- `- Depends on:` names the API endpoints or other requirements involved.
- `npm run spec:check` fails if a requirement has no SHALL, no scenario, or is neither tested nor marked manual,
  or if a test refers to an ID that isn't in a spec. `npm run spec:status` refreshes the table below.

## Capabilities

| Capability | What it covers |
| --- | --- |
| [catalog-api](catalog-api/spec.md) | Catalog endpoints, defensive parsing, retries, last-good cache, family levels |
| [tmdb-proxy](tmdb-proxy/spec.md) | The `/api/tmdb` serverless proxy and the TMDB client (art, Top 10, matching, discover) |
| [home](home/spec.md) | Billboard, preview, Continue Watching, Top 10, Top Picks, Because You Watched, rows |
| [cards](cards/spec.md) | Box art, hover cards, match %, Top 10 cards |
| [title-page](title-page/spec.md) | More Info modal: actions, details, episodes, hero trailer, more like this, ratings, My List |
| [player](player/spec.md) | Netflix-style player: quality, subtitles (SRT→VTT, Windows-1256), skips, next episode, resume, gestures |
| [search](search/spec.md) | Instant search, Arabic/English, Top Searches, genres |
| [new-and-popular](new-and-popular/spec.md) | New releases, Top 10 lists, Everyone's Watching |
| [my-list](my-list/spec.md) | My List page |
| [settings](settings/spec.md) | Family filter, subtitles, autoplay, titles language, history, persistence |
| [onboarding](onboarding/spec.md) | First-run kind/genres/favourites flow |
| [pwa](pwa/spec.md) | Manifest, icons, service worker, offline, iOS |
| [layout-and-navigation](layout-and-navigation/spec.md) | Mobile tab bar, desktop nav, arrow-key/remote focus, motion, SPA routing |
| [accounts](accounts/spec.md) | Email + password accounts, welcome screen, upgrade guest in place, sign in/out, merge, delete |
| [profiles](profiles/spec.md) | Who's watching, Kids profiles, PINs, per-profile library and sync keys |
| [tonight](tonight/spec.md) | Ask Spark: AI chat with fixed-question fallback that ends in real titles |

Profiles (see below) share one browser and one sync space. Signing in with an email and password is optional: see accounts.

## Status

<!-- status:start -->
| Capability | IDs | Requirements | Tested | Manual |
| --- | --- | ---: | ---: | ---: |
| [accounts](accounts/spec.md) | `ACC-` | 23 | 20 | 3 |
| [cards](cards/spec.md) | `CARD-` | 8 | 4 | 4 |
| [catalog-api](catalog-api/spec.md) | `API-` | 22 | 22 | 0 |
| [home](home/spec.md) | `HOME-` | 11 | 6 | 5 |
| [layout-and-navigation](layout-and-navigation/spec.md) | `NAV-` | 7 | 2 | 5 |
| [my-list](my-list/spec.md) | `MYLIST-` | 1 | 0 | 1 |
| [new-and-popular](new-and-popular/spec.md) | `NEW-` | 3 | 0 | 3 |
| [onboarding](onboarding/spec.md) | `ONB-` | 6 | 3 | 3 |
| [player](player/spec.md) | `PLAYER-` | 33 | 28 | 5 |
| [profiles](profiles/spec.md) | `PRF-` | 14 | 13 | 1 |
| [provider](provider/spec.md) | `PROV-` | 10 | 9 | 1 |
| [pwa](pwa/spec.md) | `PWA-` | 8 | 7 | 1 |
| [search](search/spec.md) | `SEARCH-` | 4 | 2 | 2 |
| [settings](settings/spec.md) | `SET-` | 9 | 6 | 3 |
| [sync](sync/spec.md) | `SYNC-` | 18 | 17 | 1 |
| [title-page](title-page/spec.md) | `TITLE-` | 9 | 7 | 2 |
| [tmdb-proxy](tmdb-proxy/spec.md) | `TMDB-` | 10 | 10 | 0 |
| [tonight](tonight/spec.md) | `TONIGHT-` | 20 | 18 | 2 |
| **Total** | | **216** | **174** | **42** |
<!-- status:end -->
