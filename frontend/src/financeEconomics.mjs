export function roundHalfUpMinor(amountMinor, bps) {
  return Number((BigInt(amountMinor) * BigInt(bps) + 5_000n) / 10_000n);
}

export function calculatePoolEconomics(totalCommissionPoolBps, orderAmountMinor) {
  const creatorEffectiveBps = roundHalfUpMinor(totalCommissionPoolBps, 6_500);
  const platformEffectiveBps = totalCommissionPoolBps - creatorEffectiveBps;
  const totalCommissionMinor = roundHalfUpMinor(
    orderAmountMinor,
    totalCommissionPoolBps
  );
  const creatorAmountMinor = roundHalfUpMinor(totalCommissionMinor, 6_500);
  return {
    totalCommissionPoolBps,
    creatorEffectiveBps,
    platformEffectiveBps,
    totalCommissionMinor,
    creatorAmountMinor,
    platformAmountMinor: totalCommissionMinor - creatorAmountMinor
  };
}

export function getApplicationUiState(application) {
  if (application.status === "APPROVED") return "APPROVED";
  if (application.status === "WITHDRAWN" || application.status === "CANCELLED") {
    return "WITHDRAWN";
  }
  if (application.status === "REJECTED") return "REJECTED";
  if (application.termsStatus === "REACCEPTANCE_REQUIRED") return "TERMS_CHANGED";
  if (application.termsStatus === "CURRENT_REACCEPTED") return "CREATOR_REACCEPTED";
  return "PENDING";
}
