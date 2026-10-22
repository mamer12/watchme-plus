import { describe, expect, it } from 'vitest';
import { shouldAutoplayTrailer, trailerSrc, TRAILER_DELAY_MS, type TrailerOptions } from './trailerLogic';

const ok: TrailerOptions = {
  trailerId: '7YpuMymmiJ8',
  enabled: true,
  reducedMotion: false,
  saveData: false,
  imageLoaded: true,
  elapsedMs: TRAILER_DELAY_MS,
  playing: false,
  hidden: false,
};

describe('trailer autoplay in the details hero', () => {
  it('TITLE-006: plays once the photo has been up for the delay', () => {
    expect(shouldAutoplayTrailer(ok)).toBe(true);
    expect(shouldAutoplayTrailer({ ...ok, elapsedMs: TRAILER_DELAY_MS - 1 })).toBe(false);
    expect(shouldAutoplayTrailer({ ...ok, imageLoaded: false })).toBe(false);
  });

  it('TITLE-006: stays on the photo with Reduce Motion, Data Saver, previews off or no trailer', () => {
    expect(shouldAutoplayTrailer({ ...ok, reducedMotion: true })).toBe(false);
    expect(shouldAutoplayTrailer({ ...ok, saveData: true })).toBe(false);
    expect(shouldAutoplayTrailer({ ...ok, enabled: false })).toBe(false);
    expect(shouldAutoplayTrailer({ ...ok, trailerId: null })).toBe(false);
  });

  it('TITLE-006: stops for the player and for a hidden tab', () => {
    expect(shouldAutoplayTrailer({ ...ok, playing: true })).toBe(false);
    expect(shouldAutoplayTrailer({ ...ok, hidden: true })).toBe(false);
  });

  it('TITLE-006: embeds youtube-nocookie, muted, without controls, looping', () => {
    const src = trailerSrc('7YpuMymmiJ8', 'https://x.test');
    expect(src.startsWith('https://www.youtube-nocookie.com/embed/7YpuMymmiJ8?')).toBe(true);
    for (const p of ['autoplay=1', 'mute=1', 'controls=0', 'playsinline=1', 'rel=0', 'modestbranding=1', 'loop=1', 'playlist=7YpuMymmiJ8', 'enablejsapi=1'])
      expect(src).toContain(p);
  });
});
