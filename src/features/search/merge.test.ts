import { describe, expect, it } from 'vitest';
import { parseTitle } from '../../api/parse';
import { mergeResults } from './merge';

const t = (nb: string, en: string, kind: string) => parseTitle({ nb, en_title: en, kind })!;

describe('search', () => {
  it('SEARCH-001: merges movies and series, prefix matches first, without duplicates', () => {
    const movies = [t('1', 'The Batman', '1'), t('2', 'Batman Begins', '1')];
    const series = [t('3', 'Batman: The Animated Series', '2'), t('2', 'Batman Begins', '1')];
    expect(mergeResults('batman', movies, series).map((x) => x.id)).toEqual(['3', '2', '1']);
    expect(mergeResults('x', [], [])).toEqual([]);
  });
});
