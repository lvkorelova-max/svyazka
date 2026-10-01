import { CommercialCalculationPolicy, OrderStatus } from '@prisma/client';
import {
  calculateFinancialAmounts,
  commissionBaseForSync,
} from './finance-calculation';

describe('Stage 8 finance sync commission base', () => {
  const agreement = {
    calculationPolicy: CommercialCalculationPolicy.LEGACY_DIRECT_RATES_V1,
    totalCommissionPoolBps: 975,
    creatorPoolShareBps: 0,
    creatorEffectiveGmvBps: 975,
    platformEffectiveGmvBps: 0,
  };

  it('uses commissionableAmountMinor for the BYSOLA gross/shipping case', () => {
    const base = commissionBaseForSync(
      {
        status: OrderStatus.PAID,
        amountKopecks: 28_575,
        returnedAmountKopecks: 0,
      },
      10_000n,
    );
    const amounts = calculateFinancialAmounts(base, agreement);

    expect(base).toBe(10_000n);
    expect(amounts.creator).toBe(975n);
  });

  it('uses the same corrected creator target for accrual posting', () => {
    const amounts = calculateFinancialAmounts(
      commissionBaseForSync(
        {
          status: OrderStatus.PAID,
          amountKopecks: 28_575,
          returnedAmountKopecks: 0,
        },
        10_000n,
      ),
      agreement,
    );
    const accrualLedgerCreatorAmount = amounts.creator;

    expect(accrualLedgerCreatorAmount).toBe(975n);
  });

  it('preserves the legacy gross-order base without a Stage 8 override', () => {
    const base = commissionBaseForSync({
      status: OrderStatus.PAID,
      amountKopecks: 28_575,
      returnedAmountKopecks: 0,
    });

    expect(base).toBe(28_575n);
    expect(calculateFinancialAmounts(base, agreement).creator).toBe(2_786n);
  });
});
