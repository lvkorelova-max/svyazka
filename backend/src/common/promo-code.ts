export const CREATOR_PROMO_CODE_NORMALIZATION_POLICY =
  'NFKC_TRIM_UPPER_V1';

const CYRILLIC_TO_LATIN: Record<string, string> = {
  А: 'A', Б: 'B', В: 'V', Г: 'G', Д: 'D', Е: 'E', Ё: 'E', Ж: 'ZH',
  З: 'Z', И: 'I', Й: 'I', К: 'K', Л: 'L', М: 'M', Н: 'N', О: 'O',
  П: 'P', Р: 'R', С: 'S', Т: 'T', У: 'U', Ф: 'F', Х: 'H', Ц: 'C',
  Ч: 'CH', Ш: 'SH', Щ: 'SH', Ъ: '', Ы: 'Y', Ь: '', Э: 'E', Ю: 'YU', Я: 'YA',
};

export function transliterateCreatorName(value: string) {
  return Array.from(value.normalize('NFKC'))
    .map((character) => CYRILLIC_TO_LATIN[character.toUpperCase()] ?? character)
    .join('');
}

export function suggestCreatorPromoCode(displayName: string) {
  const tokens = displayName.normalize('NFKC').trim().split(/\s+/).filter(Boolean);
  for (const token of [...tokens].reverse()) {
    const candidate = normalizeCreatorPromoCode(
      transliterateCreatorName(token).replace(/[^A-Za-z0-9]/g, ''),
    ).slice(0, 20);
    if (isValidCreatorPromoCode(candidate)) return candidate;
  }
  const combined = normalizeCreatorPromoCode(
    transliterateCreatorName(tokens.join('')).replace(/[^A-Za-z0-9]/g, ''),
  ).slice(0, 20);
  return isValidCreatorPromoCode(combined) ? combined : null;
}

export function normalizeCreatorPromoCode(value: string) {
  return value.normalize('NFKC').trim().toUpperCase();
}

export function isValidCreatorPromoCode(value: string) {
  return /^[A-Z0-9]{4,20}$/.test(value);
}
