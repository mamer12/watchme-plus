import { describe, expect, it } from 'vitest';
import { findMatch, normalizeName, yearOf } from './match';
import { parseTitle } from './parse';
import type { Title } from './types';

const t = (nb: string, en: string, year: string, ar = ''): Title => parseTitle({ nb, en_title: en, ar_title: ar, year })!;

describe('name matching', () => {
  it('TMDB-007: normalizes names (case, punctuation, accents, &) and keeps Arabic letters', () => {
    expect(normalizeName('Spider-Man: No Way Home')).toBe('spidermannowayhome');
    expect(normalizeName('Amélie')).toBe('amelie');
    expect(normalizeName('Tom & Jerry')).toBe(normalizeName('Tom and Jerry'));
    expect(normalizeName('الحمل!')).toBe('الحمل');
    expect(yearOf('2024-05-01')).toBe(2024);
    expect(yearOf(null)).toBeNull();
  });

  it('TMDB-007: matches by name with a ±1 year tolerance, preferring the exact year', () => {
    const list = [t('1', 'Dune', '1984'), t('2', 'Dune', '2021'), t('3', 'Dune: Part Two', '2024'), t('4', 'Dune', '2022')];
    expect(findMatch({ name: 'Dune', year: 2021 }, list)?.id).toBe('2');
    expect(findMatch({ name: 'Dune', year: 2023 }, list)?.id).toBe('4');
    expect(findMatch({ name: 'Dune', year: 2000 }, list)).toBeNull();
    expect(findMatch({ name: 'Dune Part Two', year: 2024 }, list)?.id).toBe('3');
    expect(findMatch({ name: 'La Casa de Papel', originalName: 'Money Heist', year: 2017 }, [t('9', 'Money Heist', '2017')])?.id).toBe('9');
    expect(findMatch({ name: '', year: 2020 }, list)).toBeNull();
  });
});
