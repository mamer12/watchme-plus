# Player

## Purpose

A full-screen player modeled on Netflix's web player, for the catalog's progressive MP4 files. Lazy-loaded route
`/watch/:id` (`src/features/player/`). Series play as a playlist of their episodes.

Depends on: `allVideoInfo/id/{nb}`, `transcoddedFiles/id/{nb}` (plain MP4 on the CDN, Range + CORS), `translationFiles/id/{nb}`
(SRT on the CDN), `videoSeason/id/{nb}`.

## Requirements

### PLAYER-001: Netflix layout and auto-hide
The system SHALL play full-bleed on black and, while the pointer moves or the screen is tapped, show: the back arrow
top-left; a thin red progress bar with a red scrubber dot, buffered range, hover time and the remaining time on the
right; bottom-left play/pause, back 10, forward 10 and volume; the title and episode ("Show E3 Episode 3") centered;
bottom-right Next Episode, Episodes, Audio & Subtitles, Speed and Fullscreen with popover panels. Controls and the
cursor SHALL hide after 3 seconds of inactivity while playing (never while paused, scrubbing or with a panel open).

- Verification: manual — play any title on desktop: all controls appear on mouse move and disappear after 3 s;
  each right-side icon opens its panel; dragging the red dot seeks.

#### Scenario: Idle while playing
- GIVEN the video is playing
- WHEN the mouse doesn't move for 3 seconds
- THEN controls and cursor disappear

### PLAYER-002: Keyboard
The system SHALL support Space/K play-pause (always, even with a button focused), ←/→ seek 10 s, ↑/↓ volume, F
fullscreen, M mute, S skip intro and Escape (close a panel, then cancel the next-episode countdown).

- Verification: manual — try each key on desktop; Enter still activates a focused button.

#### Scenario: Seek with arrows
- GIVEN playback at 1:00
- WHEN → is pressed
- THEN playback continues at 1:10

### PLAYER-003: Quality
The system SHALL offer 240p–1080p, plus 4K only when the browser reports HEVC support
(`MediaSource.isTypeSupported('video/mp4; codecs="hvc1.1.6.L150.90"')` or `canPlayType`), default to 1080p (or the
best quality below the saved preference), remember the chosen quality, keep the position when switching, and step
down a quality automatically when a file fails. Quality is chosen in the Audio & Subtitles panel (Auto, PERF-017, or a fixed one).

- Verification: test

#### Scenario: Desktop Chrome
- GIVEN no HEVC support
- WHEN the panel opens
- THEN 4K is not listed and 1080p is selected

### PLAYER-004: Subtitle decoding
The system SHALL fetch the SRT, decode it as UTF-8 and, if that yields replacement characters, as Windows-1256,
removing a BOM.

- Verification: test

#### Scenario: Old Arabic subtitle
- GIVEN an SRT saved in Windows-1256
- WHEN decoded
- THEN the Arabic text is correct

### PLAYER-005: SRT to WebVTT
The system SHALL convert SRT to WebVTT in the browser (comma → dot timestamps, tolerant of short timestamps),
stripping `<i>`, `<b>`, `<u>`, `<font>` and `{\an8}`-style tags, and attach it as a `<track>` via a Blob URL.

- Verification: test

#### Scenario: Styled cue
- GIVEN a cue `{\an8}<font color="#ffff00">General</font> Kenobi`
- WHEN converted
- THEN the VTT text is `General Kenobi`

### PLAYER-006: Subtitle rendering and timing
The system SHALL render the active cues over the video in Netflix style (white, soft shadow, bottom centre, raised
above visible controls) with the user's size, color, background and timing offset, and SHALL style `::cue` the same
for native fullscreen.

- Verification: test

#### Scenario: Offset
- GIVEN a +1.5 s offset
- WHEN a cue starts at 1.0 s
- THEN it shows at 2.5 s

### PLAYER-007: Skip Intro
The system SHALL show a large rounded "Skip Intro" button bottom-right while playback is inside an `introSkipping`
range; pressing it (or S) jumps to the range's end.

- Verification: test

#### Scenario: Inside the intro
- GIVEN an intro from 228 s to 246.6 s
- WHEN playback is at 230 s
- THEN Skip Intro is visible

### PLAYER-008: Family scene skipping
The system SHALL jump over every `skippingDurations` range when the "Skip flagged scenes" setting is on, with a short
notice, and play them when it is off.

- Verification: test
- Depends on: SET (familySkips)

#### Scenario: Setting on
- GIVEN a flagged scene 834–966 s and the setting on
- WHEN playback reaches 840 s
- THEN it continues at 966 s

### PLAYER-009: Next Episode
The system SHALL, for series, never start the next episode while the current one is still playing. From the moment
given by PLAYER-017 it SHALL show a plain "Next Episode" button (no countdown, no automatic advance; click or Enter goes
next at once; a close button, Back or Escape dismisses it). Only when the video ends naturally (after-credits scenes
are part of the file) and the "Autoplay next episode" setting is on, it SHALL show "Next episode in 5" with a
5-second countdown the viewer can cancel (Cancel button or Escape); with the setting off, or after a dismissal or a
cancel, the end shows an "Up Next" screen with the button and nothing autoplays. The last episode and movies show none
of this.

- Verification: test
- Depends on: SET-004, PLAYER-017

#### Scenario: Credits with a scene after them
- GIVEN a 22-minute S1:E1 with a scene after the credits, autoplay on
- WHEN playback passes 1282 s
- THEN the button shows and the episode keeps playing to its end

#### Scenario: End of video
- GIVEN the video ended and autoplay is on
- WHEN 5 seconds pass without Cancel
- THEN S1:E2 starts

### PLAYER-017: Next Episode timing
The system SHALL estimate the credits length as 3.5% of the duration clamped to 45-150 s (or use a catalog credits
start if one exists), show the button 8 s after the credits start, never before 60% of the duration nor later than 15 s
before the end (episodes too short for that show it at the end). Seeking back before that time hides the button and
resets a dismissal.

- Verification: test
- Depends on: PLAYER-009

#### Scenario: 22-minute episode
- GIVEN a 1320 s episode (credits 46.2 s)
- WHEN playback reaches 1281.8 s
- THEN the button appears (38 s before the end) and playback continues

#### Scenario: 45-minute episode
- GIVEN a 2700 s episode (credits 94.5 s)
- WHEN playback reaches 2613.5 s
- THEN the button appears (86.5 s before the end)

#### Scenario: 2-hour film
- GIVEN a movie of 7200 s
- WHEN it nears the end
- THEN no button shows (a series of that length would show it at 7058 s, credits clamped to 150 s)

#### Scenario: Dismissed
- GIVEN the viewer pressed Back on the button
- WHEN the episode ends
- THEN the Up Next screen shows and nothing autoplays

### PLAYER-010: Progress and resume
The system SHALL save the position every 5 seconds while playing, on pause, on episode change and when leaving;
resume from it next time; treat ≥94% (or <20 s left) as finished; and after finishing an episode point the series to
the next one ("Up next").

- Verification: test

#### Scenario: Come back later
- GIVEN the user left a movie at 20:00
- WHEN Play is pressed again
- THEN playback starts at 20:00

### PLAYER-011: Speed
The system SHALL offer 0.5×, 0.75×, 1× (Normal), 1.25× and 1.5× in a Netflix-style speed panel.

- Verification: test

#### Scenario: Faster
- GIVEN 1.25× is chosen
- WHEN playback continues
- THEN the video plays at 1.25×

### PLAYER-012: Touch gestures
The system SHALL, on touch screens, toggle controls with a tap, seek ±10 s with a double tap on the left/right third
(with a ripple), show large centre play/pause and ±10 buttons, and lock landscape when entering fullscreen where the
browser allows it.

- Verification: test

#### Scenario: Double tap right
- GIVEN a phone
- WHEN the right side is double-tapped
- THEN playback jumps forward 10 s

### PLAYER-013: "You're watching" pause screen
The system SHALL, after 5 seconds paused without activity, dim the video and show "You're watching", the title, the
season/episode and the synopsis, until the pointer moves or a key is pressed.

- Verification: manual — pause with Space and wait 5 s: the pause screen appears; move the mouse: it goes away.

#### Scenario: Paused
- GIVEN the video is paused and the mouse is still
- WHEN 5 seconds pass
- THEN the pause screen shows

### PLAYER-014: Episodes panel
The system SHALL list the series' episodes by season inside the player, highlighting the current one, and switch
episodes without leaving fullscreen, ignoring the previous episode's data and position while the next one loads.

- Verification: manual — open Episodes in a series, pick another episode: it plays and fullscreen stays on; let an
  episode auto-advance and check exactly the next episode plays and the previous one is saved as watched.

#### Scenario: Switch episode
- GIVEN S1:E1 playing in fullscreen
- WHEN S1:E3 is picked
- THEN S1:E3 plays in fullscreen

### PLAYER-016: Family mode switch in the player
The system SHALL show a Family mode button in the player's controls that switches the same "Skip flagged scenes"
setting on and off while a title plays, with a notice saying how many flagged scenes the title has. On a Kids profile
the button is shown on and cannot be switched off.

- Verification: test (message) and manual — play a title, press the flag button: the notice appears; with it on, a
  flagged scene is skipped; on a Kids profile the button is disabled.
- Depends on: SET (familySkips), PRF (Kids)

#### Scenario: Switching on
- GIVEN a title with 3 flagged scenes and Family mode off
- WHEN the viewer presses the Family mode button
- THEN "Family mode on · 3 scenes will be skipped" is shown and the setting is on

### PLAYER-018: Recovery before the error screen
The system SHALL, when the video reports an error, climb a bounded ladder per load before the "Playback problem"
screen, with the buffering state (and "Reconnecting...") shown meanwhile: re-seat the same source at the current time up
to twice (after 1 s, then 3 s); then load the file through the plain, non-parallel path; then one quality lower at the
same position; only then the error screen, whose Try again resumes from the saved position. A decode error re-seats
once and then steps down. The counters start over after 20 s of good playback, so the ladder never loops.

- Verification: test
- Depends on: PLAYER-015, PERF-018

#### Scenario: Slow server timeout
- GIVEN a network error during playback
- WHEN the player re-seats the source after 1 s and then 3 s and both fail
- THEN the plain path is tried, then a lower quality, and only then "Playback problem" appears

### PLAYER-019: Loading percent
The system SHALL show, centred in the loading spinner, a number counting up while the video loads (first start, after a
seek into unbuffered data, re-buffering): seconds buffered ahead of the playhead over 6 s (or what is left of the
video). It never decreases within one loading episode, rises at most 8 points per 250 ms, stays at 99 until the video
is playing, starts again from 0 on a new source, an unbuffered seek or another episode, is hidden when playback runs
and while a seamless quality swap loads the second element, and is read to screen readers as "Loading N percent" every 10
points.

- Verification: test
- Depends on: PLAYER-018

#### Scenario: Seek
- GIVEN playback running
- WHEN the viewer seeks into unbuffered data
- THEN the spinner shows 0% and counts up until the video plays

### PLAYER-020: Errors from the right element only
The system SHALL handle video errors only from the active element and from the source it holds now, ignoring errors
of the standby element and of older sources (the seamless swap swaps elements), SHALL read the position from a cached
value, and SHALL write the same error to the console at most once per 10 seconds.

- Verification: test
- Depends on: PLAYER-018, PERF-014

#### Scenario: After a swap
- GIVEN the quality swap just made the second element active
- WHEN the emptied first element reports an error
- THEN nothing happens

### PLAYER-015: Lazy route and errors
The system SHALL load the player code only when `/watch/:id` opens, and SHALL show a clear message with Try again
when the files can't be loaded or played, and "Not available with your family filter" for titles above the level.

- Verification: manual — `npm run build` lists a separate `PlayerPage-*.js` chunk; open `/watch/1` (no such video):
  a "Playback problem" screen with Try again appears.

#### Scenario: Missing files
- GIVEN `transcoddedFiles` returns nothing
- WHEN the player opens
- THEN "This video isn't available right now." is shown

### PERF-001: Start quality
The system SHALL start playback, in Auto, at the quality remembered for the provider (never above the cap), else 480p
on provider "Other" (else the lowest file of at least 360p), else on EL the highest file up to 720p. The remembered
quality (localStorage, per provider) is only the starting point; the Auto controller moves from there. With a fixed
quality picked, playback starts at that one.

- Verification: test
- Depends on: `src/lib/adaptiveQuality.ts`

#### Scenario: First visit on the mirror
- GIVEN provider Other, nothing remembered and all qualities available
- WHEN a title starts
- THEN 480p loads

### PERF-002: Resolved, fresh video links
The system SHALL warm the file's connection ahead of time with a 1-byte range request (started when the title page opens
or Play is pressed) sent with `mode: cors`, `cache: no-store`, low priority to the `cndwN.` file host that serves the
same path and query (the shared host mapping `fileHostUrl`), never to the redirecting `cdn.` host (its 302 has no CORS
headers); errors are ignored silently. The video element keeps the original link when the service worker will rewrite
it, else gets the file host's address, and the page asks the catalog for new links when a signed link (`Expires`) is about to run out or fails after it did.

- Verification: test
- Depends on: `src/lib/signedUrl.ts`, `src/lib/warmPlayback.ts`

#### Scenario: Seek
- GIVEN playback from the resolved address
- WHEN the viewer seeks
- THEN the range request goes straight to the file host

### PERF-003: Automatic quality (QualityController)
The system SHALL, with Auto on (the default; kill switch `AUTO_QUALITY` in `src/lib/qualityController.ts`), choose the
quality continuously from the measured throughput (EWMA of bytes per second from buffered growth and, with parallel
fetching, the service worker's response timings) against each file's bitrate (size from a HEAD's Content-Length ÷
duration; a typical value until known). It SHALL pick the highest level whose bitrate × 1.4 is within the throughput,
move ONE level at a time, never above the cap (Settings → Highest automatic quality, default 1080p), and wait 15 s
between switches. Up only after 25 s with at least 20 s buffered ahead (or a steady 2 s or more, for browsers that buffer little) and a direct 1 MB bandwidth probe of the next level; down at once when less than 8 s is buffered
and falling (3 s lower by 0.5 s) or throughput is under the current bitrate × 1.1 (a buffer under 4 s ignores the 15 s wait). An abandoned
swap backs off 10 s, 20 s, 40 s ... up to 2 min. No toast, spinner or message ever accompanies a change; there is no
"slow connection" hint.

- Verification: test
- Depends on: `src/lib/qualityController.ts`, PERF-014

#### Scenario: Healthy line
- GIVEN 480p plays with 30 s buffered for 25 s and throughput above 720p's bitrate × 1.4
- WHEN the controller decides
- THEN it asks for 720p, and for no level beyond that until 15 s later

### PERF-010: Parallel range fetching
The service worker SHALL, when the page has told it the provider is "Other", answer a video range request
(`Range: bytes=a-b` or `a-`) to the mirror's video hosts (`cdn.` and `cndwN.`) with one 206 response: the span, cut to
at most 8 MB, is split into 4 equal pieces fetched at the same time, and the response body emits the pieces in order
as they arrive (piece 1 starts streaming as soon as it has bytes). `Content-Range`, `Content-Length`,
`Accept-Ranges` and `Content-Type: video/mp4` are set from the file size (a HEAD's Content-Length: the file host
exposes no Content-Range), and a span that runs past the end of the file ends at the last byte. The signed link is
used on a `cndwN` file host chosen per file (the 302 host sends no CORS headers), remembered per original link, and
dropped when it is expiring or refused.

- Verification: test
- Depends on: `src/lib/parallelRange.ts`, `src/lib/parallelFetcher.ts`, `src/sw/pfSw.ts`, PERF-002

#### Scenario: Open-ended range
- GIVEN the provider is Other and the video asks for `bytes=0-`
- WHEN the worker answers
- THEN it returns 206 `bytes 0-8388607/<total>` built from 4 concurrent pieces, in order

### PERF-011: Connection and cache limits
The system SHALL keep at most 8 parallel media connections (4 for the playing video, 4 for the second video of a swap) open across the whole origin, abort every piece when the
request is aborted (a seek), and never cache video bodies.

- Verification: test
- Depends on: PERF-010, PWA-002

#### Scenario: Seek
- GIVEN a response is streaming
- WHEN the player cancels it by seeking
- THEN its pieces are aborted and their connections are free for the next request

### PERF-012: Fallback to a plain fetch
The system SHALL retry a failed piece (non-206, 429/503, network error) once, and when the first piece still fails or
the server ignores the range, let the original request go through untouched; a piece that fails mid-stream is
reopened from the byte it reached before the response is failed.

- Verification: test
- Depends on: PERF-010

#### Scenario: Throttled
- GIVEN the mirror answers 429 twice
- WHEN the player asks for a range
- THEN the original request is sent as it was

### PERF-018: Patient pieces
The system SHALL give a piece at least 8 s to answer its first byte and at least 20 s of silence in its body before
treating it as failed, retry a failed or timed-out piece once on a new connection, and when it still fails replace the
rest of the response by one plain request for the remaining bytes, so one slow connection never fails a response that
other pieces delivered. A first piece that cannot be had hands the original request back to the plain path.

- Verification: test
- Depends on: PERF-012, `src/lib/parallelPolicy.ts`

#### Scenario: Slow mirror
- GIVEN a piece stalls twice
- WHEN the player asks for a range
- THEN the response still completes with every byte, the rest fetched by one plain request

### PERF-019: Cancelled means quiet
The system SHALL abort all connections of a range request the moment the browser cancels it (a seek), so they stop
counting against the 8 connections, SHALL NOT report that as an error to the video element, and SHALL ask a file's
host and size once (HEAD), asking again only when the signed link is about to expire or was refused (403/410).

- Verification: test
- Depends on: PERF-011

#### Scenario: Seeking
- GIVEN a response is still downloading
- WHEN the viewer seeks and the browser cancels it
- THEN its pieces are aborted and the next range reuses the known file size

### PERF-013: Off by default, mirror only
The system SHALL leave every other request alone: parallel fetching runs only for the mirror's video hosts, only after
the page sent `on` for provider "Other", and not when localStorage `wmp:pf` is `off` or the worker's kill switch is
set. The page SHALL tell the worker on start, on provider change and when a new worker takes control. The `<video>`
stays a plain (no-CORS) request: the worker's synthesized 206 is accepted for it, and the 302 host cannot be used
with CORS.

- Verification: test
- Depends on: `src/lib/pfState.ts`, `src/lib/parallelPage.ts`, `src/api/endpoints.ts`

#### Scenario: EL
- GIVEN the provider is EL
- WHEN the video loads
- THEN the worker doesn't intercept it

### PERF-014: Seamless swap
The system SHALL change quality without any interruption by double buffering: a second hidden `<video>` (same
attributes, muted, `preload=auto`) loads the target file through the same warm/signed-URL path (so parallel fetching
applies), is parked at the playhead + a lead of about 2.5 s (adapted to the measured seek time) and must hold at least
4 s buffered ahead with `readyState` ≥ 3 (or 2 s with `readyState` 4) within 12 s of its metadata arriving (15 s allowed for the metadata), else the swap is dropped silently and the element emptied. It
then starts muted just before the main video reaches the parked time and, when the two playheads are within 120 ms
(a 2% speed nudge corrects small drift, a seek large drift), hands over in one animation frame: it becomes the visible
and audible element with the volume, mute, speed, subtitles, fullscreen and controls carried over, and the old element
is paused and emptied (`removeAttribute('src')`, `load()`). The rest of the page always talks to the active element
(`useActiveVideo`). No waiting spinner, pause, time jump or settings change results. Manual picks use the same swap and
reload the file only if the swap cannot happen.

- Verification: test
- Depends on: `src/lib/seamlessSwap.ts`, `src/features/player/swapEngine.ts`, PERF-002, PERF-010

#### Scenario: Auto steps up
- GIVEN 480p plays and the controller asks for 720p
- WHEN the 720p element is buffered and aligned
- THEN the 720p element takes over within 120 ms of the same time and playback never pauses

### PERF-015: Swap state machine and cancellation
The system SHALL run a swap as idle → preparing → ready → aligning → swapped, drop it (aborted) on timeout (12 s
preparing, 6 s aligning), on a seek, a new episode or an error, run one at a time, and while the video is paused only
prepare and hold, completing the swap after play. It SHALL not swap while picture in picture or native fullscreen holds
the main element.

- Verification: test
- Depends on: PERF-014

#### Scenario: Seek during a swap
- GIVEN a swap is being prepared
- WHEN the viewer seeks
- THEN the swap is cancelled and the second element emptied

### PERF-016: Drift correction
The system SHALL park the second video at playhead + lead (never past the last second), start it when the main video is
within its start latency of the parked time, swap when the playheads are within 120 ms, play the second video at 98%
(ahead) or 102% (behind) speed for drift up to 400 ms, and seek it again beyond that.

- Verification: test
- Depends on: PERF-014

#### Scenario: Slightly ahead
- GIVEN the second video is 200 ms ahead
- WHEN the drift is checked
- THEN it plays at 0.98× until within 120 ms

### PERF-017: Auto in the quality menu
The system SHALL list "Auto" first in the quality menu, selected by default and showing the current level, e.g.
"Auto (480p)". Picking a fixed quality turns Auto off (remembered) until Auto is picked again; Settings has a Quality
select (Auto or fixed) and a "Highest automatic quality" cap.

- Verification: test
- Depends on: PERF-003

#### Scenario: Auto on 480p
- GIVEN Auto is on and 480p is playing
- WHEN the quality menu opens
- THEN "Auto (480p)" is selected
