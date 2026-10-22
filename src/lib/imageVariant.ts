/** Which image file to ask for. Pure. */
import type { Title } from '../api/types';

export type ImageUse = 'card' | 'hero';

export interface ImageChoice {
  src: string | null;
  fallback: string | null;
}

/**
 * Cards and rows take the small poster (`..._poster_medium_thumb`, ~30 KB, 293x439) and only fall back to the
 * full poster (~285 KB); the hero takes the wide cover (~300 KB, logo baked in) and falls back to the poster.
 * The tiny `_thumb` files (100 px wide) are too soft for cards and are not used.
 */
export function pickImage(t: Pick<Title, 'poster' | 'posterThumb' | 'cover'>, use: ImageUse): ImageChoice {
  if (use === 'hero') return { src: t.cover ?? t.poster ?? t.posterThumb, fallback: t.cover ? t.poster ?? t.posterThumb : null };
  const small = t.posterThumb ?? t.poster;
  return { src: small, fallback: small === t.poster ? null : t.poster };
}

/** Max images downloading at once, by provider: the mirror's image host is slow, so fewer, in order. */
export const IMAGE_SLOTS = { el: 8, albox: 8, other: 4 } as const;

/** A FIFO of slots: `acquire` calls `go` when a slot is free and returns a release function (idempotent). */
export function slotQueue(max: () => number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  const pump = () => {
    while (active < max() && waiting.length) waiting.shift()?.();
  };
  return {
    acquire(go: () => void): () => void {
      let state: 'waiting' | 'held' | 'done' = 'waiting';
      const start = () => {
        state = 'held';
        active += 1;
        go();
      };
      waiting.push(start);
      pump();
      return () => {
        if (state === 'waiting') waiting.splice(waiting.indexOf(start), 1);
        else if (state === 'held') {
          active -= 1;
          pump();
        }
        state = 'done';
      };
    },
    get active() {
      return active;
    },
  };
}
