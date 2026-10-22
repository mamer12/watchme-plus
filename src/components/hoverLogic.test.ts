import { describe, expect, it } from 'vitest';
import { HOVER_CLOSE_GRACE_MS, HOVER_TRAILER_MS, shouldCloseHover, shouldPreviewTrailer, type HoverTrailerOptions } from './hoverLogic';

const ok: HoverTrailerOptions = { trailerId: 'abcdefghijk', enabled: true, reducedMotion: false, saveData: false, canHover: true, openMs: HOVER_TRAILER_MS };

describe('hover card trailer', () => {
  it('CARD-003: plays after the card has been open long enough, and keeps being allowed while it stays', () => {
    expect(shouldPreviewTrailer(ok)).toBe(true);
    expect(shouldPreviewTrailer({ ...ok, openMs: 60_000 })).toBe(true);
    expect(shouldPreviewTrailer({ ...ok, openMs: HOVER_TRAILER_MS - 1 })).toBe(false);
  });

  it('CARD-003: only the setting, Reduce Motion, Data Saver, touch and a missing trailer turn it off (not the provider)', () => {
    expect(shouldPreviewTrailer({ ...ok, enabled: false })).toBe(false);
    expect(shouldPreviewTrailer({ ...ok, reducedMotion: true })).toBe(false);
    expect(shouldPreviewTrailer({ ...ok, saveData: true })).toBe(false);
    expect(shouldPreviewTrailer({ ...ok, canHover: false })).toBe(false);
    expect(shouldPreviewTrailer({ ...ok, trailerId: null })).toBe(false);
  });

  it('CARD-003: a pointer that slips off for a moment does not close the card', () => {
    expect(shouldCloseHover(null, 1000)).toBe(false);
    expect(shouldCloseHover(1000, 1000 + HOVER_CLOSE_GRACE_MS - 1)).toBe(false);
    expect(shouldCloseHover(1000, 1000 + HOVER_CLOSE_GRACE_MS)).toBe(true);
  });
});
