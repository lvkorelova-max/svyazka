import { Prisma } from "@prisma/client";

export const COMMISSION_SCOPE = {
  WHOLE_STORE: "WHOLE_STORE",
  SELECTED_PRODUCTS: "SELECTED_PRODUCTS",
} as const;

export type CommissionScope =
  (typeof COMMISSION_SCOPE)[keyof typeof COMMISSION_SCOPE];

export type CommissionEligibilitySnapshot = {
  scope: CommissionScope;
  externalProductIds: string[];
};

export type CanonicalOrderLine = {
  externalProductId: string;
  category?: string;
  quantity: string;
  amountMinor: string;
};

export type CommissionEligibilityProjectionLine = CanonicalOrderLine & {
  commissionable: boolean;
  commissionableAmountMinor: string;
};

export type CommissionEligibilityProjection = {
  scope: CommissionScope;
  sourceAgreementSnapshot: true;
  externalProductIds: string[];
  lines: CommissionEligibilityProjectionLine[];
  orderAmountMinor: string;
  shippingAmountMinor: string;
  merchandiseAmountMinor: string;
  commissionableAmountMinor: string;
};

export function normalizeCommissionEligibility(
  value: Prisma.JsonValue | Record<string, unknown> | null | undefined,
): CommissionEligibilitySnapshot {
  const object = jsonObject(value);
  const rawScope = object?.scope;
  const scope =
    rawScope === "SELECTED_PRODUCTS"
      ? COMMISSION_SCOPE.SELECTED_PRODUCTS
      : COMMISSION_SCOPE.WHOLE_STORE;
  const externalProductIds =
    scope === COMMISSION_SCOPE.SELECTED_PRODUCTS
      ? uniqueStrings(object?.externalProductIds)
      : [];
  return { scope, externalProductIds };
}

export function projectCommissionEligibility(input: {
  agreementSnapshot: Prisma.JsonValue | Record<string, unknown>;
  productLines: Prisma.JsonValue | null;
  orderAmountMinor: bigint;
  shippingAmountMinor: bigint;
}): CommissionEligibilityProjection {
  const snapshot = normalizeCommissionEligibility(input.agreementSnapshot);
  const merchandiseAmountMinor =
    input.orderAmountMinor > input.shippingAmountMinor
      ? input.orderAmountMinor - input.shippingAmountMinor
      : 0n;
  const selected = new Set(snapshot.externalProductIds);
  const lines = canonicalLines(input.productLines).map((line) => {
    const commissionable =
      snapshot.scope === COMMISSION_SCOPE.WHOLE_STORE ||
      selected.has(line.externalProductId);
    return {
      ...line,
      commissionable,
      commissionableAmountMinor: commissionable ? line.amountMinor : "0",
    };
  });
  const selectedLineAmount = lines.reduce(
    (sum, line) => sum + BigInt(line.commissionableAmountMinor),
    0n,
  );
  const commissionableAmountMinor =
    snapshot.scope === COMMISSION_SCOPE.WHOLE_STORE
      ? merchandiseAmountMinor
      : selectedLineAmount > merchandiseAmountMinor
        ? merchandiseAmountMinor
        : selectedLineAmount;
  return {
    scope: snapshot.scope,
    sourceAgreementSnapshot: true,
    externalProductIds: snapshot.externalProductIds,
    lines,
    orderAmountMinor: input.orderAmountMinor.toString(),
    shippingAmountMinor: input.shippingAmountMinor.toString(),
    merchandiseAmountMinor: merchandiseAmountMinor.toString(),
    commissionableAmountMinor: commissionableAmountMinor.toString(),
  };
}

export function proportionalCommissionableRefund(input: {
  orderAmountMinor: bigint;
  commissionableAmountMinor: bigint;
  returnedAmountMinor: bigint;
}) {
  if (
    input.orderAmountMinor <= 0n ||
    input.commissionableAmountMinor <= 0n ||
    input.returnedAmountMinor <= 0n
  ) {
    return 0n;
  }
  if (input.returnedAmountMinor >= input.orderAmountMinor) {
    return input.commissionableAmountMinor;
  }
  const allocated =
    (input.commissionableAmountMinor * input.returnedAmountMinor +
      input.orderAmountMinor / 2n) /
    input.orderAmountMinor;
  return allocated > input.commissionableAmountMinor
    ? input.commissionableAmountMinor
    : allocated;
}

function canonicalLines(value: Prisma.JsonValue | null): CanonicalOrderLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const object = jsonObject(item);
    if (
      !object ||
      typeof object.externalProductId !== "string" ||
      typeof object.quantity !== "string" ||
      typeof object.amountMinor !== "string" ||
      !/^[1-9]\d*$/.test(object.quantity) ||
      !/^\d+$/.test(object.amountMinor)
    ) {
      return [];
    }
    return [
      {
        externalProductId: object.externalProductId,
        ...(typeof object.category === "string"
          ? { category: object.category }
          : {}),
        quantity: object.quantity,
        amountMinor: object.amountMinor,
      },
    ];
  });
}

function uniqueStrings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].sort();
}

function jsonObject(value: unknown) {
  return value && !Array.isArray(value) && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}
