-- One number instead of two: Service.basePrice is now both the engine base (the
-- payable minimum) and the "from $X" the site lists; the display-only fromPrice
-- teaser is folded into it and dropped. The listed price becomes honest by
-- construction (option deltas are >= 0, so no configuration prices below base).
--
-- Fill is conditional on basePrice = 0 so a service whose base already carries
-- engine meaning is never overwritten — handyman's $95/hr base (engine multiplies
-- by quantity) would be broken by its $150 compare-table teaser.
--
-- NOTE: for the filled services, computed totals RISE by the old teaser amount
-- until option deltas are re-tuned in /admin/catalog (cheapest required option to
-- $0, others to increments). The seed carries re-tuned deltas for fresh databases;
-- live rows are the admin's to re-tune, by decision.

UPDATE "Service"
SET "basePrice" = "fromPrice"
WHERE "basePrice" = 0 AND "fromPrice" IS NOT NULL AND "fromPrice" > 0;

ALTER TABLE "Service" DROP COLUMN "fromPrice";
