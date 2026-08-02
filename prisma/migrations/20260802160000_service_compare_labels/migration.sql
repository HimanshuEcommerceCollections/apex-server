-- Admin-editable display labels for the pricing Compare table (nullable, non-destructive).
ALTER TABLE "Service" ADD COLUMN "typicalDuration" TEXT;
ALTER TABLE "Service" ADD COLUMN "recurringDiscount" TEXT;
