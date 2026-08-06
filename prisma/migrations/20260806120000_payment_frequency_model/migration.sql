-- Separates PAYMENT FREQUENCY from MEMBERSHIP PACKAGE.
--
--   RecurringCadence = how often the customer pays (One-time is a member of the
--                      set, interval NONE — not a null).
--   ServicePlan      = a package of benefits the customer buys.
--
-- Every agreement (Booking, Membership) now carries a cadence, so "is this a
-- subscription?" is `cadence.interval <> 'NONE'` and never a null check. The
-- cadence lives on the agreement, NOT on Payment: a subscription emits many
-- payments and they all inherit their frequency from the Membership.

-- ── 1. Cadence: the one-time row becomes load-bearing, so protect it ─────────
ALTER TABLE "RecurringCadence" ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false;

-- Guarantee it exists before anything points at it.
INSERT INTO "RecurringCadence" ("id", "key", "label", "interval", "intervalCount", "sortOrder", "status", "isSystem", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'one-time', 'One-time', 'NONE', 1, 0, 'ACTIVE', true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "RecurringCadence" WHERE "key" = 'one-time');

UPDATE "RecurringCadence" SET "isSystem" = true, "status" = 'ACTIVE' WHERE "key" = 'one-time';

-- ── 2. ServiceRecurring: Stripe anchor for configuration-based subscriptions ─
-- Mirrors the ServicePlan wiring: a $0 price carrying the cadence's interval,
-- with the real amount added per cycle as an invoice item.
ALTER TABLE "ServiceRecurring" ADD COLUMN "stripeProductId" TEXT;
ALTER TABLE "ServiceRecurring" ADD COLUMN "stripePriceId" TEXT;

-- ── 3. Booking: cadence is mandatory; everything existing is one-time ────────
ALTER TABLE "Booking" ADD COLUMN "cadenceId" TEXT;
ALTER TABLE "Booking" ADD COLUMN "recurringDiscountPercent" INTEGER NOT NULL DEFAULT 0;

UPDATE "Booking"
SET "cadenceId" = (SELECT "id" FROM "RecurringCadence" WHERE "key" = 'one-time')
WHERE "cadenceId" IS NULL;

ALTER TABLE "Booking" ALTER COLUMN "cadenceId" SET NOT NULL;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_cadenceId_fkey"
  FOREIGN KEY ("cadenceId") REFERENCES "RecurringCadence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Booking_cadenceId_idx" ON "Booking"("cadenceId");

-- ── 4. Membership: plan optional, cadence mandatory, charge snapshot ─────────
-- planId null = configuration-based subscription (built on a service page from
-- a configured job + a payment frequency), where `amount` is the binding price.
ALTER TABLE "Membership" ALTER COLUMN "planId" DROP NOT NULL;
ALTER TABLE "Membership" ADD COLUMN "cadenceId" TEXT;
ALTER TABLE "Membership" ADD COLUMN "amount" INTEGER;
ALTER TABLE "Membership" ADD COLUMN "discountPercent" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Membership" ADD COLUMN "taxRateBps" INTEGER NOT NULL DEFAULT 0;

-- Existing memberships are all plan-backed: inherit the plan's cadence and
-- freeze the price/tax they are already being billed at.
UPDATE "Membership" m
SET "cadenceId" = p."cadenceId", "amount" = p."price"
FROM "ServicePlan" p
WHERE p."id" = m."planId" AND m."cadenceId" IS NULL;

UPDATE "Membership" m
SET "taxRateBps" = s."taxRateBps"
FROM "Service" s
WHERE s."id" = m."serviceId";

-- Any row the join could not resolve falls back to one-time rather than
-- blocking the migration.
UPDATE "Membership"
SET "cadenceId" = (SELECT "id" FROM "RecurringCadence" WHERE "key" = 'one-time')
WHERE "cadenceId" IS NULL;

ALTER TABLE "Membership" ALTER COLUMN "cadenceId" SET NOT NULL;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_cadenceId_fkey"
  FOREIGN KEY ("cadenceId") REFERENCES "RecurringCadence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Membership_cadenceId_idx" ON "Membership"("cadenceId");

-- ── 5. Payment: exactly one parent ──────────────────────────────────────────
-- A payment settles a booking OR a membership invoice, never both and never
-- neither. Both writers already satisfy this; the constraint keeps it true.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_one_parent"
  CHECK (num_nonnulls("bookingId", "membershipId") = 1);
