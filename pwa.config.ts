import type { VitePWAOptions } from 'vite-plugin-pwa';
import { API_HOSTNAMES, IMAGE_HOSTNAMES } from './src/api/endpoints';

const escapeHost = (h: string) => h.replace(/\./g, '\\.');
/** Route matchers are serialized into the service worker, so they can't close over imports: hosts are inlined. */
const imageRoute = new Function(
  '{ url, request }',
  `return request.destination === 'image' && (${JSON.stringify([...IMAGE_HOSTNAMES, 'image.tmdb.org', 'i.ytimg.com'])}).includes(url.hostname);`,
) as (o: { url: URL; request: { destination: string } }) => boolean;

/** Posters and banners: repeat views come from the cache. */
export const IMAGE_CACHE = { name: 'images', maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30, statuses: [0, 200] } as const;

export const APP_NAME = 'Watchme+';
export const THEME_COLOR = '#141414';

/** PWA manifest + service worker strategy. Videos are never cached (no route matches the video CDN). */
export const pwaOptions: Partial<VitePWAOptions> = {
  registerType: 'autoUpdate',
  injectRegister: false,
  includeAssets: ['favicon.svg', 'favicon-32.png', 'apple-touch-icon.png'],
  manifest: {
    id: '/',
    name: APP_NAME,
    short_name: APP_NAME,
    description: 'Movies and series from the catalog, in a fast, beautiful player.',
    lang: 'en',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: THEME_COLOR,
    theme_color: THEME_COLOR,
    categories: ['entertainment'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  workbox: {
    /** A new worker takes over at once, so an update reaches people on their next visit (main.tsx reloads once). */
    skipWaiting: true,
    clientsClaim: true,
    globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
    /** Parallel range fetching for the mirror's videos (src/sw/pfSw.ts, emitted by vite.config.ts); the browser keeps its own copy. */
    importScripts: ['pf-sw.js'],
    globIgnores: ['pf-sw.js'],
    navigateFallback: '/index.html',
    navigateFallbackDenylist: [/^\/api\//],
    cleanupOutdatedCaches: true,
    runtimeCaching: [
      {
        urlPattern: new RegExp(`^https://(${API_HOSTNAMES.map(escapeHost).join('|')})/api/`),
        handler: 'NetworkFirst',
        options: {
          cacheName: 'catalog-api',
          networkTimeoutSeconds: 8,
          expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 3 },
          cacheableResponse: { statuses: [200] },
        },
      },
      {
        urlPattern: ({ url }) => url.pathname === '/api/tmdb',
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: 'tmdb-proxy',
          expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 7 },
          cacheableResponse: { statuses: [200] },
        },
      },
      {
        urlPattern: imageRoute,
        handler: 'CacheFirst',
        options: {
          cacheName: IMAGE_CACHE.name,
          expiration: { maxEntries: IMAGE_CACHE.maxEntries, maxAgeSeconds: IMAGE_CACHE.maxAgeSeconds, purgeOnQuotaError: true },
          cacheableResponse: { statuses: [...IMAGE_CACHE.statuses] },
        },
      },
    ],
  },
};
