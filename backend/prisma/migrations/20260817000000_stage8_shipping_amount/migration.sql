ALTER TABLE "Order"
ADD COLUMN "shippingAmountMinor" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "Stage8OrderEvent"
ADD COLUMN "shippingAmountMinor" BIGINT;
