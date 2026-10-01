import { CommercialCalculationPolicy } from '@prisma/client';
import {
  calculateBpsHalfUp,
  calculateFinancialAmounts,
} from './finance-calculation';

describe('Stage 7 financial calculation invariants', () => {
  it.each([
    [800, 520, 280],
    [1500, 975, 525],
    [2500, 1625, 875],
  ])(
    'calculates POOL_65_35_V1 for %i BPS',
    (poolBps, creatorExpected, platformExpected) => {
      const result = calculateFinancialAmounts(10_000n, {
        calculationPolicy: CommercialCalculationPolicy.POOL_65_35_V1,
        totalCommissionPoolBps: poolBps,
        creatorPoolShareBps: 6500,
        creatorEffectiveGmvBps: creatorExpected,
        platformEffectiveGmvBps: platformExpected,
      });
      expect(result.creator).toBe(BigInt(creatorExpected));
      expect(result.platform).toBe(BigInt(platformExpected));
      expect(result.creator + result.platform).toBe(result.total);
    },
  );

  it.each([1n, 7n, 19n, 101n, 1_999n, 10_005n, 2_147_483_647n])(
    'reconciles exactly for unusual amount %s',
    (amountMinor) => {
      const result = calculateFinancialAmounts(amountMinor, {
        calculationPolicy: CommercialCalculationPolicy.POOL_65_35_V1,
        totalCommissionPoolBps: 1500,
        creatorPoolShareBps: 6500,
        creatorEffectiveGmvBps: 975,
        platformEffectiveGmvBps: 525,
      });
      expect(result.creator + result.platform).toBe(result.total);
      expect(result.creator).toBeGreaterThanOrEqual(0n);
      expect(result.platform).toBeGreaterThanOrEqual(0n);
    },
  );

  it('uses deterministic half-up rounding at the server boundary', () => {
    expect(calculateBpsHalfUp(1_999n, 1500)).toBe(300n);
    expect(calculateBpsHalfUp(300n, 6500)).toBe(195n);
  });

  it('preserves legacy direct rates without applying the pool split', () => {
    const result = calculateFinancialAmounts(10_000n, {
      calculationPolicy:
        CommercialCalculationPolicy.LEGACY_DIRECT_RATES_V1,
      totalCommissionPoolBps: 1700,
      creatorPoolShareBps: 0,
      creatorEffectiveGmvBps: 1200,
      platformEffectiveGmvBps: 500,
    });
    expect(result.creator).toBe(1200n);
    expect(result.platform).toBe(500n);
    expect(result.total).toBe(1700n);
  });

  it('rejects negative money and invalid BPS', () => {
    expect(() => calculateBpsHalfUp(-1n, 1500)).toThrow(RangeError);
    expect(() => calculateBpsHalfUp(100n, 10_001)).toThrow(RangeError);
    expect(() => calculateBpsHalfUp(100n, 1.5)).toThrow(RangeError);
  });
});
