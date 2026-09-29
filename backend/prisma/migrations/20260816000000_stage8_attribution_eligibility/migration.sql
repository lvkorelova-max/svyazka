ALTER TABLE "Order"
  ADD COLUMN "productLines" JSONB,
  ADD COLUMN "commissionEligibilityProjection" JSONB,
  ADD COLUMN "commissionableAmountMinor" BIGINT,
  ADD COLUMN "returnedCommissionableAmountMinor" BIGINT NOT NULL DEFAULT 0;
