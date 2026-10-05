import {
  CREATOR_PROMO_CODE_NORMALIZATION_POLICY,
  isValidCreatorPromoCode,
  normalizeCreatorPromoCode,
  suggestCreatorPromoCode,
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

  it.each([
    ['Пеня Петунин', 'PETUNIN'],
    ['Ada Lovelace', 'LOVELACE'],
  ])('suggests the last meaningful name token for %s', (displayName, expected) => {
    expect(suggestCreatorPromoCode(displayName)).toBe(expected);
  });

  it('returns no suggestion when no meaningful token can satisfy the stored contract', () => {
    expect(suggestCreatorPromoCode('李')).toBeNull();
  });
});
