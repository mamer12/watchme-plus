import { describe, expect, it } from 'vitest';
import { moreLikeThisQuery } from './moreLikeThis';

describe('more like this', () => {
  it('TITLE-008: asks for the same kind in the first known genre, defaulting to Drama', () => {
    expect(moreLikeThisQuery({ kind: 'series', genres: [{ en: 'Musical', ar: '' }, { en: 'Crime', ar: '' }] })).toEqual({ kind: 'series', genreId: 60 });
    expect(moreLikeThisQuery({ kind: 'movie', genres: [] })).toEqual({ kind: 'movie', genreId: 62 });
  });
});
