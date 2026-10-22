import { describe, expect, it } from 'vitest';
import { artPlan } from './boxArt';

const art = { tmdbId: 1, media: 'movie' as const, backdrop: 'https://image.tmdb.org/t/p/w780/b.jpg', logoEn: 'en.png', logoAr: null };

describe('box art', () => {
  it('CARD-001: cover first, then TMDB backdrop + logo, then the poster with the title as text', () => {
    expect(artPlan({ cover: 'cover.jpg', poster: 'p.jpg', posterThumb: null }, art, 'en')).toEqual({ type: 'cover', image: 'cover.jpg' });
    expect(artPlan({ cover: null, poster: 'p.jpg', posterThumb: null }, art, 'en')).toEqual({ type: 'tmdb', image: art.backdrop, logo: 'en.png' });
    expect(artPlan({ cover: null, poster: 'p.jpg', posterThumb: null }, art, 'ar')).toEqual({ type: 'tmdb', image: art.backdrop, logo: 'en.png' });
    expect(artPlan({ cover: null, poster: 'p.jpg', posterThumb: null }, null, 'en')).toEqual({ type: 'poster', image: 'p.jpg' });
    expect(artPlan({ cover: null, poster: null, posterThumb: 't.jpg' }, { ...art, backdrop: null }, 'en')).toEqual({ type: 'poster', image: 't.jpg' });
  });
});
