import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pwaOptions } from '../pwa.config';
import { usableProviders } from '../src/api/endpoints';

const root = new URL('..', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');

type Matcher = RegExp | ((o: { url: URL; request: { destination: string } }) => boolean);
const routes = (pwaOptions.workbox?.runtimeCaching ?? []) as { urlPattern: Matcher; handler: string }[];
const routeFor = (href: string, destination = '') =>
  routes.find((r) =>
    r.urlPattern instanceof RegExp ? r.urlPattern.test(href) : r.urlPattern({ url: new URL(href), request: { destination } }),
  );

describe('deployment config', () => {
  it('PWA-001: has an installable manifest named Watchme+ with standalone display and maskable icons', () => {
    const m = pwaOptions.manifest;
    if (!m) throw new Error('manifest missing');
    expect(m.name).toBe('Watchme+');
    expect(m.short_name).toBe('Watchme+');
    expect(m.display).toBe('standalone');
    expect(m.theme_color).toBe('#141414');
    expect(m.icons?.some((i) => i.purpose === 'maskable' && i.sizes === '512x512')).toBe(true);
    expect(m.icons?.some((i) => i.sizes === '192x192')).toBe(true);
    for (const icon of m.icons ?? []) expect(() => readFileSync(new URL(`public${icon.src}`, root))).not.toThrow();
  });

  it('PWA-002: caches the shell, API and images but never video', () => {
    expect(pwaOptions.workbox?.navigateFallback).toBe('/index.html');
    expect(pwaOptions.workbox?.navigateFallbackDenylist?.some((r) => r.test('/api/tmdb'))).toBe(true);
    for (const p of usableProviders()) {
      expect(routeFor(`https://${p.host}/api/android/banner/level/0`)?.handler).toBe('NetworkFirst');
      expect(routeFor(`https://${p.imageHosts[0]}/vascin-poster-images/a.jpg`, 'image')?.handler).toBe('CacheFirst');
    }
    expect(routeFor('https://cnth2.shabakaty.com/vascin-poster-images/a.jpg', 'image')?.handler).toBe('CacheFirst');
    expect(routeFor('https://image.tmdb.org/t/p/w780/a.jpg', 'image')?.handler).toBe('CacheFirst');
    expect(routeFor('https://cdn.shabakaty.com/vascin24-mp4/a_video.mp4', 'video')).toBeUndefined();
    expect(routeFor('https://cnth2.shabakaty.com/vascin-translation-files/a.srt', '')).toBeUndefined();
  });

  it('PWA-004: index.html carries the iOS web-app tags and the Watchme+ title', () => {
    const html = read('index.html');
    expect(html).toContain('<title>Watchme+</title>');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain('apple-mobile-web-app-capable');
    expect(html).toContain('apple-mobile-web-app-status-bar-style');
    expect(html).toContain('name="theme-color"');
  });

  it('NAV-007: vercel.json rewrites app routes to index.html but not /api or assets', () => {
    const cfg = JSON.parse(read('vercel.json')) as { rewrites: { source: string; destination: string }[]; outputDirectory: string };
    expect(cfg.outputDirectory).toBe('dist');
    const rule = cfg.rewrites[0];
    expect(rule?.destination).toBe('/index.html');
    const re = new RegExp(`^${(rule?.source ?? '').replace('/(', '/(')}$`);
    expect(re.test('/title/123')).toBe(true);
    expect(re.test('/watch/123')).toBe(true);
    expect(re.test('/api/tmdb')).toBe(false);
    expect(re.test('/assets/index.js')).toBe(false);
  });
});
