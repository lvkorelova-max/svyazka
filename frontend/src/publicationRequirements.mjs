export function buildDefaultPublicationRequirements(brandName) {
  const normalizedBrandName = String(brandName || "").trim();
  const brandMention = normalizedBrandName
    ? `упомянуть бренд «${normalizedBrandName}»`
    : "упомянуть бренд";

  return `Указать название и цену, добавить маркировку рекламы, ${brandMention}.`;
}
