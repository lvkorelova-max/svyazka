import {
  CREATOR_PROMO_CODE_NORMALIZATION_POLICY,
  isValidCreatorPromoCode,
  normalizeCreatorPromoCode,
} from './promo-code';

describe('creator promo-code normalization', () => {
  it('uses one versioned normalization policy', () => {
    expect(CREATOR_PROMO_CODE_NORMALIZATION_POLICY).toBe(
      'NFKC_TRIM_UPPER_V1',
    );
  });

  it.each([
    ['MELISSA10', 'MELISSA10'],
    ['melissa10', 'MELISSA10'],
    [' Melissa10 ', 'MELISSA10'],
    ['ＭＥＬＩＳＳＡ１０', 'MELISSA10'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeCreatorPromoCode(input)).toBe(expected);
  });

  it('accepts only Tilda-compatible Latin letters and digits', () => {
    expect(isValidCreatorPromoCode('MELISSA10')).toBe(true);
    expect(isValidCreatorPromoCode('КОД10')).toBe(false);
    expect(isValidCreatorPromoCode('CODE-10')).toBe(false);
  });
});
