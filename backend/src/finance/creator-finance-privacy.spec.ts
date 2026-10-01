import { FinanceService } from "./finance.service";

describe("FinanceService Creator finance privacy projection", () => {
  const prisma = {
    creatorProfile: { findUnique: jest.fn() },
    order: { findMany: jest.fn(), count: jest.fn() },
  } as any;
  const config = { get: jest.fn() } as any;
  const audit = { requestId: jest.fn(() => "privacy-test-request") } as any;
  const brands = {} as any;

  beforeEach(() => jest.clearAllMocks());

  it("omits internal order and commission economics while retaining creator-safe payout data", async () => {
    prisma.creatorProfile.findUnique.mockResolvedValue({ id: "creator-1" });
    prisma.order.findMany.mockResolvedValue([
      {
        id: "order-1",
        affiliateRelationshipId: "relationship-1",
        brandId: "brand-1",
        offerId: "offer-1",
        orderDate: new Date("2026-08-08T01:30:00.000Z"),
        status: "PAID",
        currency: "RUB",
        amountKopecks: 100000,
        returnedAmountKopecks: 0,
        creatorCommissionBps: 1250,
        platformCommissionBps: 750,
        totalCommissionPoolBps: 2000,
        creatorPoolShareBps: 6250,
        platformPoolShareBps: 3750,
        creatorCommissionAmountMinor: 12500n,
        totalCommissionAmountMinor: 20000n,
        platformCommissionAmountMinor: 7500n,
        commercialTermsVersionNumber: 4,
        affiliateCommercialAgreementId: "agreement-1",
        offer: { id: "offer-1", title: "Visible offer" },
        affiliateRelationship: {
          creator: { id: "creator-1", displayName: "Creator" },
        },
        commission: {
          id: "commission-1",
          creatorId: "creator-1",
          offerId: "offer-1",
          payoutId: "payout-1",
          creatorAmountKopecks: 12500,
          creatorAmountMinor: 12500n,
          platformAmountKopecks: 7500,
          platformAmountMinor: 7500n,
          totalAmountMinor: 20000n,
          debtAmountKopecks: 0,
          recoverableAmountMinor: 0n,
          hasPostPayoutDebt: false,
          status: "PAYABLE",
          currency: "RUB",
          offer: { id: "offer-1", title: "Visible offer" },
          creator: { id: "creator-1", displayName: "Creator" },
          order: null,
          payout: {
            id: "payout-1",
            amountKopecks: 12500n,
            currency: "RUB",
            status: "PAID",
            createdAt: new Date("2026-08-09T00:00:00.000Z"),
            paidAt: new Date("2026-08-10T00:00:00.000Z"),
            creatorId: "creator-1",
            createdByUserId: "admin-1",
            approvedByUserId: "admin-1",
            paidByUserId: "admin-1",
            reference: "internal-reference",
          },
        },
      },
    ]);
    prisma.order.count.mockResolvedValue(1);

    const result = await new FinanceService(
      prisma,
      config,
      audit,
      brands,
    ).listCreatorOrders("creator-user-1", {
      page: 1,
      pageSize: 25,
      sortBy: "orderDate",
      sortDirection: "desc",
    });

    expect(prisma.creatorProfile.findUnique).toHaveBeenCalledWith({
      where: { userId: "creator-user-1" },
    });
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          affiliateRelationship: { creatorId: "creator-1" },
          orderDate: undefined,
        },
        orderBy: { orderDate: "desc" },
        skip: 0,
        take: 25,
      }),
    );

    const order = result.items[0] as any;
    expect(order).toEqual(
      expect.objectContaining({
        id: "order-1",
        status: "PAID",
        currency: "RUB",
        amountKopecks: 100000,
        creatorEffectiveBps: 1250,
        creatorCommissionAmountMinor: 12500n,
        commission: expect.objectContaining({
          id: "commission-1",
          status: "PAYABLE",
          creatorAmountMinor: 12500n,
          offer: { id: "offer-1", title: "Visible offer" },
          payout: {
            id: "payout-1",
            amountMinor: 12500n,
            currency: "RUB",
            status: "PAID",
            createdAt: new Date("2026-08-09T00:00:00.000Z"),
            paidAt: new Date("2026-08-10T00:00:00.000Z"),
          },
        }),
      }),
    );

    for (const field of [
      "brandId",
      "platformCommissionBps",
      "totalCommissionPoolBps",
      "creatorPoolShareBps",
      "platformPoolShareBps",
      "totalCommissionAmountMinor",
      "platformCommissionAmountMinor",
      "commercialTermsVersionNumber",
      "affiliateCommercialAgreementId",
    ]) {
      expect(order).not.toHaveProperty(field);
    }
    for (const field of [
      "platformAmountKopecks",
      "platformAmountMinor",
      "totalAmountMinor",
      "debtAmountKopecks",
      "recoverableAmountMinor",
      "hasPostPayoutDebt",
    ]) {
      expect(order.commission).not.toHaveProperty(field);
    }
    for (const field of [
      "creatorId",
      "createdByUserId",
      "approvedByUserId",
      "paidByUserId",
      "reference",
    ]) {
      expect(order.commission.payout).not.toHaveProperty(field);
    }
  });

  it("keeps creator ownership in the Prisma filter and preserves query filters and pagination metadata", async () => {
    prisma.creatorProfile.findUnique.mockResolvedValue({ id: "creator-1" });
    prisma.order.findMany.mockResolvedValue([
      {
        id: "order-2",
        creatorCommissionBps: 1000,
        creatorCommissionAmountMinor: 1000n,
        commission: null,
      },
    ]);
    prisma.order.count.mockResolvedValue(3);

    const result = await new FinanceService(
      prisma,
      config,
      audit,
      brands,
    ).listCreatorOrders("creator-user-1", {
      dateFrom: "2026-08-01T00:00:00.000Z",
      dateTo: "2026-08-31T00:00:00.000Z",
      offerId: "offer-2",
      orderStatus: "PENDING" as any,
      attributionSource: "AFFILIATE" as any,
      page: 2,
      pageSize: 1,
      sortBy: "createdAt",
      sortDirection: "asc",
    });

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          affiliateRelationship: { creatorId: "creator-1" },
          orderDate: {
            gte: new Date("2026-08-01T00:00:00.000Z"),
            lte: new Date("2026-08-31T23:59:59.999Z"),
          },
          offerId: "offer-2",
          status: "PENDING",
          attributionSource: "AFFILIATE",
        },
        orderBy: { createdAt: "asc" },
        skip: 1,
        take: 1,
      }),
    );
    expect(prisma.order.count).toHaveBeenCalledWith({
      where: {
        affiliateRelationship: { creatorId: "creator-1" },
        orderDate: {
          gte: new Date("2026-08-01T00:00:00.000Z"),
          lte: new Date("2026-08-31T23:59:59.999Z"),
        },
        offerId: "offer-2",
        status: "PENDING",
        attributionSource: "AFFILIATE",
      },
    });
    expect(result.pagination).toEqual({ page: 2, pageSize: 1, totalItems: 3 });
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        id: "order-2",
        creatorEffectiveBps: 1000,
        creatorCommissionAmountMinor: 1000n,
        commission: null,
      }),
    );
  });

  it("preserves an existing commission when its payout relation is absent", async () => {
    prisma.creatorProfile.findUnique.mockResolvedValue({ id: "creator-1" });
    prisma.order.findMany.mockResolvedValue([
      {
        id: "order-3",
        creatorCommissionBps: 1000,
        creatorCommissionAmountMinor: 1000n,
        commission: {
          id: "commission-3",
          creatorAmountKopecks: 1000,
          creatorAmountMinor: null,
          status: "AVAILABLE",
          offer: { id: "offer-3", title: "Visible offer" },
          creator: null,
          order: null,
          payout: null,
        },
      },
    ]);
    prisma.order.count.mockResolvedValue(1);

    const result = await new FinanceService(
      prisma,
      config,
      audit,
      brands,
    ).listCreatorOrders("creator-user-1", {
      page: 1,
      pageSize: 25,
      sortBy: "orderDate",
      sortDirection: "desc",
    });

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        commission: expect.objectContaining({
          id: "commission-3",
          creatorAmountMinor: 1000n,
        }),
      }),
    );
    expect((result.items[0] as any).commission.payout).toBeUndefined();
  });
});
