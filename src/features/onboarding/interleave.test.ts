import { describe, expect, it } from 'vitest';
import { parseTitle } from '../../api/parse';
import { interleave } from './interleave';

const t = (nb: string) => parseTitle({ nb, en_title: `T${nb}` })!;

describe('onboarding', () => {
  it('ONB-004: interleaves popular movies and series, without duplicates, up to the limit', () => {
    expect(interleave([t('1'), t('2'), t('3')], [t('9'), t('1')], 10).map((x) => x.id)).toEqual(['1', '9', '2', '3']);
    expect(interleave([t('1'), t('2')], [t('3'), t('4')], 3).map((x) => x.id)).toEqual(['1', '3', '2']);
  });
});
