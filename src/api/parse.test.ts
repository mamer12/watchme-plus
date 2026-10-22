import { describe, expect, it } from 'vitest';
import {
  parseCategories,
  parseDetails,
  parseEpisodes,
  parseGroups,
  parseSubtitles,
  parseTitle,
  parseTitleList,
  parseVideoFiles,
  url,
} from './parse';

const full = {
  nb: '3129755',
  en_title: 'The Weight',
  ar_title: 'الحمل',
  en_content: 'A veteran smuggles gold.',
  ar_content: 'محارب قديم',
  year: '2026',
  stars: '7.3',
  kind: '1',
  season: '0',
  episodeNummer: '0',
  duration: '6781.33',
  filmRating: '4',
  seriesRating: '1',
  imgObjUrl: 'https://cnth2.shabakaty.com/vascin-poster-images/A_poster.jpg',
  imgMediumThumbObjUrl: 'https://cnth2.shabakaty.com/vascin-poster-images/A_medium.jpg',
  imdbUrlRef: 'https://www.imdb.com/title/tt10794054',
  categories: [{ en_title: 'Action', ar_title: 'اكشن' }, null, { en_title: null }],
  trailer: 'https://www.youtube.com/watch?v=7YpuMymmiJ8',
};

describe('catalog parsing', () => {
  it('API-001: parses a title with every field as a string', () => {
    const t = parseTitle(full);
    expect(t).toMatchObject({
      id: '3129755',
      kind: 'movie',
      enTitle: 'The Weight',
      arTitle: 'الحمل',
      year: 2026,
      stars: 7.3,
      season: null,
      episode: null,
      duration: 6781.33,
      filmRating: 4,
      imdbId: 'tt10794054',
      genres: [{ en: 'Action', ar: 'اكشن' }],
    });
  });

  it('API-001: survives nulls, numbers, missing fields and junk without throwing', () => {
    const t = parseTitle({ nb: 42, en_title: null, ar_title: 'فقط عربي', year: null, stars: 'n/a', kind: null, categories: 'x', imgObjUrl: null });
    expect(t).toMatchObject({ id: '42', enTitle: 'فقط عربي', arTitle: 'فقط عربي', year: null, stars: null, kind: 'movie', genres: [], poster: null, imdbId: null });
    expect(parseTitle(null)).toBeNull();
    expect(parseTitle({ nb: null, en_title: 'x' })).toBeNull();
    expect(parseTitle({ nb: '1' })).toBeNull();
    expect(parseTitleList('<html>error</html>')).toEqual([]);
    expect(parseTitleList(null)).toEqual([]);
    expect(parseTitleList([full, full, null, 5, { nb: '2', en_title: 'B', kind: '2' }]).map((t) => t.id)).toEqual(['3129755', '2']);
  });

  it('API-002: makes image paths absolute and recognises banner covers', () => {
    expect(url('vascin-poster-images/x.jpg')).toBe('https://cnth2.shabakaty.com/vascin-poster-images/x.jpg');
    expect(url('http://cnth2.shabakaty.com/a.jpg')).toBe('https://cnth2.shabakaty.com/a.jpg');
    expect(url('defaultImages/not_available.jpg')).toBeNull();
    const banner = parseTitle({
      ...full,
      imgObjUrl: 'https://cnth2.shabakaty.com/vascin-cover-images/F5_cover.jpg',
      imgMediumThumbObjUrl: 'vascin-poster-images/3D_poster_medium_thumb.jpg?Signature=a%2Bb',
    });
    expect(banner?.cover).toBe('https://cnth2.shabakaty.com/vascin-cover-images/F5_cover.jpg');
    expect(banner?.poster).toBe('https://cnth2.shabakaty.com/vascin-poster-images/3D_poster_medium_thumb.jpg?Signature=a%2Bb');
    expect(parseTitle(full)?.cover).toBeNull();
  });

  it('API-003: sorts episodes by season then episode number (numbers as strings)', () => {
    const eps = parseEpisodes([
      { nb: '5', en_title: 'S', kind: '2', season: '2', episodeNummer: '1' },
      { nb: '3', en_title: 'S', kind: '2', season: '1', episodeNummer: '10' },
      { nb: '4', en_title: 'S', kind: '2', season: '1', episodeNummer: '2' },
      { nb: '6', en_title: 'S', kind: '2', season: null, episodeNummer: null },
    ]);
    expect(eps.map((e) => e.id)).toEqual(['6', '4', '3', '5']);
  });

  it('API-004: parses details with cast, directors, intro and family skips', () => {
    const d = parseDetails({
      ...full,
      actorsInfo: [{ name: 'Catherine Zeta-Jones' }, { name: null }, 'x'],
      directorsInfo: [{ name: 'Leo Scherman' }],
      writersInfo: [{ name: 'Matthew Booi (Written by)' }],
      introSkipping: [{ start: '227.99', end: '246.61', control_level: '3' }, { start: 'x', end: '1' }],
      skippingDurations: { start: ['834.1', '1276.9', '50'], end: ['966.7', '1279.5'] },
    });
    expect(d?.actors).toEqual(['Catherine Zeta-Jones']);
    expect(d?.directors).toEqual(['Leo Scherman']);
    expect(d?.introSkips).toEqual([{ start: 227.99, end: 246.61 }]);
    expect(d?.familySkips).toEqual([
      { start: 834.1, end: 966.7 },
      { start: 1276.9, end: 1279.5 },
    ]);
    const bare = parseDetails({ nb: '1', en_title: 'X', introSkipping: null, skippingDurations: null, actorsInfo: null });
    expect(bare).toMatchObject({ actors: [], directors: [], introSkips: [], familySkips: [] });
  });

  it('API-005: parses video files, sorted by height, dropping broken entries', () => {
    const files = parseVideoFiles([
      { resolution: '1080p', videoUrl: 'https://cdn.shabakaty.com/a1080.mp4' },
      { resolution: '240p', videoUrl: 'https:\/\/cdn.shabakaty.com\/a240.mp4' },
      { resolution: null, videoUrl: 'https://cdn/x.mp4' },
      { resolution: '720p', videoUrl: null },
      { resolution: '2160p', videoUrl: 'https://cdn.shabakaty.com/a2160.mp4' },
    ]);
    expect(files.map((f) => f.resolution)).toEqual(['240p', '1080p', '2160p']);
    expect(parseVideoFiles({ error: 'x' })).toEqual([]);
  });

  it('API-006: reads Arabic and English subtitle paths, null when missing', () => {
    expect(parseSubtitles({ arTranslationFilePath: 'https://cnth2.shabakaty.com/a.srt', enTranslationFilePath: '' })).toEqual({
      ar: 'https://cnth2.shabakaty.com/a.srt',
      en: null,
    });
    expect(parseSubtitles(null)).toEqual({ ar: null, en: null });
  });

  it('API-007: parses curated groups and categories, skipping empty ones', () => {
    const groups = parseGroups({ groups: [{ title: 'Featured Movies', groupsID: '26', content: [full] }, { title: 'Empty', content: null }, null] });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: '26', title: 'Featured Movies' });
    expect(parseCategories([{ nb: '84', title: 'Action' }, { nb: null, title: 'X' }])).toEqual([{ id: 84, title: 'Action' }]);
  });
});
