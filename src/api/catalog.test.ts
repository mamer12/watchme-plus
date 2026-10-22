import { describe, expect, it } from 'vitest';
import { apiBase } from './endpoints';
import { endpoints, genreId } from './catalog';

const API_BASE = apiBase();

describe('catalog endpoints', () => {
  it('API-010: applies the family level to every list endpoint', () => {
    const e = endpoints(2);
    expect(e.groups('en')).toBe(`${API_BASE}videoGroups/lang/en/level/2`);
    expect(e.banner()).toBe(`${API_BASE}banner/level/2`);
    expect(e.latest('movie', 1, 30)).toBe(`${API_BASE}latestMovies/level/2/itemsPerPage/30/page/1/`);
    expect(e.latest('series', 2, 10)).toContain('latestSeries/level/2/');
    expect(e.byGenre('series', 84, 0)).toBe(
      `${API_BASE}AdvancedSearch?level=2&type=series&category_id=84&year=2010,2030&page=0`,
    );
    expect(endpoints(3).search('cars', 'movie', 0)).toContain('level=3');
  });

  it('SEARCH-002: encodes Arabic and English queries', () => {
    expect(endpoints(0).search('الحمل', 'movie', 0)).toContain('videoTitle=%D8%A7%D9%84%D8%AD%D9%85%D9%84&type=movies');
    expect(endpoints(0).search('Tom & Jerry', 'series', 1)).toContain('videoTitle=Tom%20%26%20Jerry&type=series&page=1');
  });

  it('HOME-008: maps genre names (and aliases) to the catalog category ids for genre rows', () => {
    expect(genreId('Action')).toBe(84);
    expect(genreId('Science Fiction')).toBe(78);
    expect(genreId('Musical')).toBeNull();
  });
});
