import {
  normalizeCommissionEligibility,
  projectCommissionEligibility,
  proportionalCommissionableRefund,
} from "./commission-eligibility";

describe("immutable commission eligibility", () => {
  it("treats legacy ALL_OFFER_PRODUCTS snapshots as WHOLE_STORE", () => {
    expect(
      normalizeCommissionEligibility({
        source: "LEGACY",
        scope: "ALL_OFFER_PRODUCTS",
      }),
    ).toEqual({ scope: "WHOLE_STORE", externalProductIds: [] });
  });

  it("excludes paid shipping from WHOLE_STORE commissionable amount", () => {
    const result = projectCommissionEligibility({
      agreementSnapshot: { scope: "WHOLE_STORE" },
      productLines: [
        {
          externalProductId: "SKU-1",
          quantity: "1",
          amountMinor: "70000",
        },
        {
          externalProductId: "SKU-2",
          quantity: "2",
          amountMinor: "30000",
        },
      ],
      orderAmountMinor: 110000n,
      shippingAmountMinor: 10000n,
    });
    expect(result.commissionableAmountMinor).toBe("100000");
    expect(result.merchandiseAmountMinor).toBe("100000");
    expect(result.lines.every((line) => line.commissionable)).toBe(true);
  });

  it("keeps existing WHOLE_STORE behavior for free shipping", () => {
    const result = projectCommissionEligibility({
      agreementSnapshot: { scope: "WHOLE_STORE" },
      productLines: null,
      orderAmountMinor: 100000n,
      shippingAmountMinor: 0n,
    });
    expect(result.shippingAmountMinor).toBe("0");
    expect(result.merchandiseAmountMinor).toBe("100000");
    expect(result.commissionableAmountMinor).toBe("100000");
  });

  it("keeps mixed-cart lines visible and zeroes ineligible lines", () => {
    const result = projectCommissionEligibility({
      agreementSnapshot: {
        scope: "SELECTED_PRODUCTS",
        externalProductIds: ["SKU-ELIGIBLE"],
      },
      productLines: [
        {
          externalProductId: "SKU-ELIGIBLE",
          quantity: "1",
          amountMinor: "60000",
        },
        {
          externalProductId: "SKU-INELIGIBLE",
          quantity: "1",
          amountMinor: "40000",
        },
      ],
      orderAmountMinor: 100000n,
      shippingAmountMinor: 0n,
    });
    expect(result.commissionableAmountMinor).toBe("60000");
    expect(result.lines).toEqual([
      expect.objectContaining({
        externalProductId: "SKU-ELIGIBLE",
        commissionable: true,
        commissionableAmountMinor: "60000",
      }),
      expect.objectContaining({
        externalProductId: "SKU-INELIGIBLE",
        commissionable: false,
        commissionableAmountMinor: "0",
      }),
    ]);
  });

  it("allocates aggregate refunds only against the original commissionable amount", () => {
    expect(
      proportionalCommissionableRefund({
        orderAmountMinor: 100000n,
        commissionableAmountMinor: 60000n,
        returnedAmountMinor: 25000n,
      }),
    ).toBe(15000n);
    expect(
      proportionalCommissionableRefund({
        orderAmountMinor: 100000n,
        commissionableAmountMinor: 60000n,
        returnedAmountMinor: 100000n,
      }),
    ).toBe(60000n);
  });
});
