export const CREATOR_PROMO_CODE_NORMALIZATION_POLICY =
  'NFKC_TRIM_UPPER_V1';

export function normalizeCreatorPromoCode(value: string) {
  return value.normalize('NFKC').trim().toUpperCase();
}

export function isValidCreatorPromoCode(value: string) {
  return /^[A-Z0-9]{4,20}$/.test(value);
}
