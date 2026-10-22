import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { build as esbuild } from 'esbuild';
import { pwaOptions } from './pwa.config';
import { DEFAULT_ISP, PROVIDERS, hostsFor } from './src/api/endpoints';

/** Preconnect only to the default provider; the others get a cheap DNS hint (the app preconnects the active one at runtime). */
const hints = PROVIDERS.flatMap((p) =>
  hostsFor(p.id).map((h) => ({ h, rel: p.id === DEFAULT_ISP ? 'preconnect' : 'dns-prefetch' })),
);

export default defineConfig({
  plugins: [
    react(),
    {
      /** Bundles the service worker add-on (parallel range fetching) next to the generated worker. */
      name: 'pf-sw',
      apply: 'build',
      async generateBundle() {
        const out = await esbuild({ entryPoints: ['src/sw/pfSw.ts'], bundle: true, minify: true, format: 'iife', target: 'es2020', write: false });
        this.emitFile({ type: 'asset', fileName: 'pf-sw.js', source: out.outputFiles[0]!.text });
      },
    },
    VitePWA(pwaOptions),
    { name: 'catalog-host', transformIndexHtml: () => [
        ...hints.map(({ h, rel }) => ({
          tag: 'link',
          attrs: rel === 'preconnect' ? { rel, href: `https://${h}`, crossorigin: '' } : { rel, href: `https://${h}` },
          injectTo: 'head-prepend' as const,
        })),
      ],
    },
  ],
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 400,
  },
});
