-- Collapse PricingMode to two values: FROM (binding, paid at booking) and QUOTE
-- (coordinator sets the final amount). PRICED and FROM were mechanically
-- identical — one engine, one snapshot, one chargeable total; PRICED was merely
-- FROM without the "from $X" display band — so PRICED services become FROM.
--
-- Data first, then the enum shrink (Postgres cannot drop a value from an enum
-- in place: rename the old type, create the new one, cast the column across,
-- drop the old type). Service.pricingMode has no column default to re-create.

UPDATE "Service" SET "pricingMode" = 'FROM' WHERE "pricingMode" = 'PRICED';

ALTER TYPE "PricingMode" RENAME TO "PricingMode_old";
CREATE TYPE "PricingMode" AS ENUM ('FROM', 'QUOTE');
ALTER TABLE "Service"
  ALTER COLUMN "pricingMode" TYPE "PricingMode"
  USING ("pricingMode"::text::"PricingMode");
DROP TYPE "PricingMode_old";
