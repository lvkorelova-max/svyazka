const CYRILLIC_TO_LATIN = {
  А: "A", Б: "B", В: "V", Г: "G", Д: "D", Е: "E", Ё: "E", Ж: "ZH",
  З: "Z", И: "I", Й: "I", К: "K", Л: "L", М: "M", Н: "N", О: "O",
  П: "P", Р: "R", С: "S", Т: "T", У: "U", Ф: "F", Х: "H", Ц: "C",
  Ч: "CH", Ш: "SH", Щ: "SH", Ъ: "", Ы: "Y", Ь: "", Э: "E", Ю: "YU", Я: "YA"
};

function transliterateCreatorName(value) {
  return Array.from(value.normalize("NFKC"))
    .map((character) => CYRILLIC_TO_LATIN[character.toUpperCase()] ?? character)
    .join("");
}

export function suggestCreatorPromoCode(displayName) {
  const tokens = displayName.normalize("NFKC").trim().split(/\s+/).filter(Boolean);
  for (const token of [...tokens].reverse()) {
    const candidate = transliterateCreatorName(token)
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase()
      .slice(0, 20);
    if (/^[A-Z0-9]{4,20}$/.test(candidate)) return candidate;
  }
  const combined = transliterateCreatorName(tokens.join(""))
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 20);
  return /^[A-Z0-9]{4,20}$/.test(combined) ? combined : null;
}
