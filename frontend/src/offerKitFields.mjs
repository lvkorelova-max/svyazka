import { buildOfferProductFacts, formatOfferProductFacts } from "./offerProductFacts.mjs";

const claimsOfType = (kit, type) => Array.isArray(kit?.claimsRaw)
  ? kit.claimsRaw.filter(claim => claim.type === type)
  : (kit?.[type === "ALLOWED" ? "allowedClaims" : "forbiddenClaims"] || []).map(value => ({ type, value }));
const claimText = claims => claims.map(claim => claim.value).join("; ");
const restrictiveAccess = items => ({
  accessLevel: items.some(item => item.accessLevel === "PRODUCT") ? "PRODUCT" : "DIGITAL",
  requiresAffiliateApproval: items.some(item => item.requiresAffiliateApproval),
});

export function getOfferKitFormFields(kit) {
  return {
    productFacts: formatOfferProductFacts(kit?.factsRaw || []),
    allowedClaims: claimText(claimsOfType(kit, "ALLOWED")),
    forbiddenClaims: claimText(claimsOfType(kit, "FORBIDDEN")),
    publicationRequirements: (kit?.publicationRaw?.mandatoryMentions || []).join("\n"),
  };
}

function buildClaims(text, initial, type) {
  if (String(text || "").trim() === claimText(initial).trim()) return initial;
  const inherited = restrictiveAccess(initial);
  return String(text || "").split(/\r?\n|;/).map(value => value.trim()).filter(Boolean).map(value => ({
    ...(initial.find(claim => claim.value === value) || inherited), type, value,
  }));
}

export function buildOfferKitFields(form, initialKit) {
  const initialFacts = initialKit?.factsRaw || [];
  let factsRaw = buildOfferProductFacts(form.productFacts, initialFacts);
  if (String(form.productFacts || "").trim() !== formatOfferProductFacts(initialFacts)) {
    factsRaw = factsRaw.map(fact => ({ ...fact, ...restrictiveAccess(initialFacts) }));
  }
  const unchangedClaims = String(form.allowedClaims || "").trim() === claimText(claimsOfType(initialKit, "ALLOWED")).trim()
    && String(form.forbiddenClaims || "").trim() === claimText(claimsOfType(initialKit, "FORBIDDEN")).trim();
  const claimsRaw = (unchangedClaims && Array.isArray(initialKit?.claimsRaw) ? initialKit.claimsRaw : [
    ...buildClaims(form.allowedClaims, claimsOfType(initialKit, "ALLOWED"), "ALLOWED"),
    ...buildClaims(form.forbiddenClaims, claimsOfType(initialKit, "FORBIDDEN"), "FORBIDDEN"),
  ]).map((claim, sortOrder) => ({ ...claim, sortOrder }));
  const initialPublication = initialKit?.publicationRaw;
  const mandatoryMentions = String(form.publicationRequirements || "").split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  const publicationRaw = initialPublication || mandatoryMentions.length ? {
    ...(initialPublication || {}), mandatoryMentions,
    hashtags: initialPublication?.hashtags || [],
    allowedPlatforms: initialPublication?.allowedPlatforms || [],
    approvalRequired: Boolean(initialPublication?.approvalRequired),
  } : undefined;
  return { factsRaw, claimsRaw, ...(publicationRaw ? { publicationRaw } : {}) };
}
