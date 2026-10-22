# Watchme+

A fast, Netflix-style web app (PWA) for a streaming catalog: mobile first, great on desktop and TV
browsers. It is an unofficial alternative client: it reads the catalog's public API straight from the browser and plays
the videos directly from the catalog's CDN.

> Videos and subtitles stream directly from the catalog's CDN, so Watchme+ plays wherever the catalog itself works
> (if a network can't reach the catalog, videos won't play there either). Watchme+ hosts no media.

## Features

- **Home, Movies, Series**: a rotating billboard (the catalog's wide covers, a muted preview on desktop after 3 s), then
  Continue Watching, Top 10 Movies/Series This Week, Top Picks for You, Because You Watched…, My List, the catalog's
  curated rows, new releases and genre rows ordered by taste.
- **Cards**: 16:9 box art (TMDB textless backdrop + logo, the catalog cover, or poster), portrait posters on phones,
  Netflix-style hover cards with Play, My List, rating, % Match, age rating, length and genres.
- **More Info** modal, deep-linkable at `/title/:id`: Play/Resume (S1:E3, minutes left), Restart, My List,
  like/love/dislike, cast, director, genres, trailer (youtube-nocookie), episodes by season with progress, More Like This.
- **Player** (`/watch/:id`), modeled on Netflix's web player: red progress bar and scrubber, ±10 s, volume, quality
  (240p–1080p, 4K when the browser decodes HEVC), Arabic/English subtitles converted from SRT (UTF-8 or Windows-1256)
  with size/color/background/timing, speed 0.5–1.5×, Skip Intro, family scene skipping, Next Episode countdown, episodes
  panel, resume, "You're watching" pause screen, keyboard shortcuts, double-tap seeking and landscape fullscreen on phones.
- **Search** (Arabic and English, instant), **New & Popular**, **My List**, **Settings** (family filter, subtitles,
  previews, autoplay, titles language, clear history) and a first-run **onboarding** that seeds recommendations with
  all-time favourites.
- **PWA**: installable, offline shell and last-good data, iOS home-screen support. Arrow-key navigation for TV remotes.
- Single user, no accounts: everything is stored in the browser.

The behaviour is specified in [`specs/`](specs/README.md) (OpenSpec style); tests are named after requirement IDs and
`npm run spec:check` keeps the two in step.

## Tech

Vite + React 18 + TypeScript (strict), React Router, plain CSS, `vite-plugin-pwa`, Vitest. One Vercel serverless
function (`api/tmdb.ts`) proxies TMDB so the key never reaches the browser.

```
api/tmdb.ts            TMDB proxy (allow-listed paths, edge-cached)
src/api/               Catalog + TMDB clients, defensive parser, retry/cache layer
src/features/          home, title, player (lazy), search, newpopular, mylist, settings, onboarding
src/components/        cards, rows, billboard, layout, icons
src/state/             library store (settings, My List, ratings, progress) in localStorage
src/lib/               subtitles, recommendations, ratings, formatting, spatial navigation
specs/                 requirements per capability
tests/                 proxy and deployment-config tests
```

## Local development

Requires Node 20+.

```bash
npm i
npm run dev          # http://localhost:5173 — everything except TMDB features
```

TMDB features (box art logos, Top 10, Because You Watched, onboarding favourites) need the proxy. Put your key in
`.env.local` (never commit it) and run through Vercel's dev server:

```bash
cp .env.example .env.local      # then set TMDB_KEY=... (a v3 API key or a v4 read token starting with eyJ)
npx vercel dev                  # serves the app and /api/tmdb together
```

Without a key the app still works: cards fall back to posters and the TMDB rows are hidden.

```bash
npm test             # unit tests (Vitest)
npm run spec:check   # every spec requirement is tested or marked manual
npm run build        # type-check + production build into dist/
```

## Deploy (Vercel)

```bash
npx vercel                       # first time: link/create the project (framework: Vite, output: dist)
npx vercel env add TMDB_KEY      # paste the key for Production (and Preview if you like)
npx vercel --prod                # deploy
```

`vercel.json` sets the build (`npm run build` → `dist`), rewrites every route except `/api/*` and `/assets/*` to
`index.html`, keeps `sw.js` uncached and caches hashed assets for a year. The proxy answers are cached at Vercel's edge
for a day (`s-maxage=86400, stale-while-revalidate`).

## Notes

- The connection is picked automatically: on every start Watchme+ probes the providers in `src/api/endpoints.ts` (EL, Albox when configured, then the mirror), starts from the last one that worked and switches by itself when another is better or the current one stops answering. Settings → Connection shows it and has a Re-check button. For troubleshooting, open the site with `?isp=el`, `?isp=albox` or `?isp=other` to force a provider (stored; automatic switching is off for that session).
- To add Albox: edit its one line in `PROVIDERS` (`host`, `imageHosts`, `enabled: true`; add `apiPath` if the API path differs from `/api/android/`).

- Stuck on an old build or a broken cache? Open the site with `?reset=1` (e.g. `https://watch-me-plus.vercel.app/?reset=1`) or `#reset`: it deletes everything stored in the browser (settings, My List, caches, service worker) without asking and starts over. The same "Reset site data" action is in Settings.
- Quality is automatic and seamless (Netflix style): `src/lib/qualityController.ts` decides, `src/features/player/swapEngine.ts` swaps files through a second hidden `<video>` without a pause. Kill switch: `AUTO_QUALITY` in `qualityController.ts`. Quality menu: Auto or a fixed quality; Settings has the cap.
- The catalog's API sometimes fails or returns HTML; requests are retried 3 times with backoff and the last good answer
  is kept in localStorage, so rows don't disappear.
- 4K files are HEVC: offered only when the browser can decode them (Safari, Edge, many Android devices).
- Icons are generated by `python3 scripts/gen-icons.py` (Pillow).
- Watchme+ is not affiliated with the catalog provider, Netflix or TMDB. This product uses the TMDB API but is not
  endorsed or certified by TMDB.
