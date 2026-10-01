export const PRODUCT_FACTS_PLACEHOLDER =
  "Описание, преимущества, состав, применение, цена, объём, производство, аудитория и ограничения";

export function formatOfferProductFacts(facts = []) {
  return facts
    .map((fact) => String(fact?.value || "").trim())
    .filter(Boolean)
    .join("\n");
}

export function buildOfferProductFacts(value, initialFacts = []) {
  const normalizedValue = String(value || "").trim();
  const initialValue = formatOfferProductFacts(initialFacts);

  if (normalizedValue === initialValue) {
    return initialFacts.map((fact, index) => ({ ...fact, sortOrder: index }));
  }
  if (!normalizedValue) return [];

  return [{
    type: "FEATURES",
    value: normalizedValue,
    accessLevel: "DIGITAL",
    requiresAffiliateApproval: false,
    sortOrder: 0
  }];
}
