# My List

## Purpose

The user's saved titles on their own page. Code: `src/features/mylist/MyListPage.tsx`.

## Requirements

### MYLIST-001: My List page
The system SHALL show every title in My List as a grid, newest first, from saved snapshots (so it works offline), with
an empty state that links back to browsing.

- Verification: manual — add two titles, open `/my-list`: both appear, newest first; remove one from its card; with
  the network off the page still renders.
- Depends on: TITLE-003

#### Scenario: Empty list
- GIVEN nothing was added
- WHEN `/my-list` opens
- THEN "Your list is empty" and a Browse button show
