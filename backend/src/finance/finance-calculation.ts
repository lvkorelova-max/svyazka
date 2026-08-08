import { CommercialCalculationPolicy } from '@prisma/client';

export type FinancialRateSnapshot = {
  calculationPolicy: CommercialCalculationPolicy;
  totalCommissionPoolBps: number;
  creatorPoolShareBps: number;
  creatorEffectiveGmvBps: number;
  platformEffectiveGmvBps: number;
};

export function calculateBpsHalfUp(
  amountMinor: bigint,
  bps: number,
): bigint {
  if (amountMinor < 0n) {
    throw new RangeError('amountMinor must be non-negative');
  }
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new RangeError('bps must be an integer between 0 and 10000');
  }
  return (amountMinor * BigInt(bps) + 5_000n) / 10_000n;
}

export function calculateFinancialAmounts(
  eligibleAmountMinor: bigint,
  terms: FinancialRateSnapshot,
) {
  if (
    terms.calculationPolicy ===
    CommercialCalculationPolicy.POOL_65_35_V1
  ) {
    const total = calculateBpsHalfUp(
      eligibleAmountMinor,
      terms.totalCommissionPoolBps,
    );
    const creator = calculateBpsHalfUp(
      total,
      terms.creatorPoolShareBps,
    );
    return { total, creator, platform: total - creator };
  }
  const creator = calculateBpsHalfUp(
    eligibleAmountMinor,
    terms.creatorEffectiveGmvBps,
  );
  const platform = calculateBpsHalfUp(
    eligibleAmountMinor,
    terms.platformEffectiveGmvBps,
  );
  return { total: creator + platform, creator, platform };
}
