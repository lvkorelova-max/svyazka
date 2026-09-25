import { OrderImportAction, OrderImportRowStatus } from '@prisma/client';
import { FinanceService } from './finance.service';

describe('Phase 3 order manager snapshot', () => {
  it('writes the relationship manager at new-order creation and leaves updates untouched', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'order-a' });
    const tx = {
      affiliateRelationship: {
        findUnique: jest.fn().mockResolvedValue({ currentManagerId: 'manager-a' }),
      },
      offer: { findFirst: jest.fn().mockResolvedValue({
        id: 'offer-a',
        creatorCommissionBps: 100,
        platformCommissionBps: 500,
      }) },
      order: { create, findFirst: jest.fn() },
      orderImport: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
      auditLog: { create: jest.fn() },
      commission: { findUnique: jest.fn(), create: jest.fn() },
      ledgerEntry: { create: jest.fn(), upsert: jest.fn(), findMany: jest.fn() },
    } as any;
    const prisma = {
      user: { findUnique: jest.fn() },
      brandProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'brand-a' }) },
      orderImport: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'import-a',
          status: 'READY',
          rows: [
            {
              rowNumber: 2,
              status: OrderImportRowStatus.VALID,
              action: OrderImportAction.CREATE,
              attributedRelationshipId: 'relationship-a',
              offerId: 'offer-a',
              externalOrderId: 'external-a',
              orderDate: new Date(),
              amountKopecks: 1000,
              returnedAmountKopecks: 0,
              currency: 'RUB',
              orderStatus: 'PAID',
              attributionSource: 'AFFILIATE_CODE',
              affiliateCode: 'code',
              promoCode: null,
              clickId: null,
              creatorCommissionBpsSnapshot: 100,
              platformCommissionBpsSnapshot: 500,
            },
          ],
        }),
      },
      $transaction: jest.fn((callback: (value: unknown) => unknown) => callback(tx)),
    } as any;
    const brands = { resolveBrand: jest.fn().mockResolvedValue({ id: 'brand-a' }) };
    const service = new FinanceService(
      prisma,
      {} as any,
      { requestId: jest.fn(() => 'request-id') } as any,
      brands as any,
    );
    await service.confirmOrderImport('brand-user', 'import-a');
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ managerIdAtAttribution: 'manager-a' }),
    });
  });
});
