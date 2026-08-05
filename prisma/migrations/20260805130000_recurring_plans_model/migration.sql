-- The Recurring/Plans model (admin-controlled pricing, stage 1: schema).
--
--  * Configurations: groups gain an admin-written description; QUANTITY groups
--    gain a pricing strategy (unitLabel + unitPrice) — quantity × unitPrice,
--    with basePrice staying a flat minimum.
--  * RecurringCadence: the global cadence vocabulary (One-time/Weekly/…),
--    admin-extendable. ServiceRecurring: per-service % + isActive per cadence —
--    THE discount mechanism; "up to X%" labels are now derived, so the stored
--    Service.recurringDiscount label is dropped.
--  * ServicePlan: admin-composed purchasable plans (service + cadence + bullets
--    + binding price). Replaces the free-text ServiceRecurringPlan cards, which
--    are dropped WITHOUT data migration — the old amounts were display strings;
--    admins recreate plans in /admin/plans.
--  * ServicePricingRule is retired. Frequency percent rules are folded into
--    ServiceRecurring below; the one non-frequency rule (smart-home "3+ devices
--    -> 15%") dies with it, by decision.
--  * Service.taxRateBps: per-service tax, applied at checkout. Initialised to
--    700 (7%) to match the standing "/pricing" FAQ copy; admin-tunable.

-- 1. Enums.
CREATE TYPE "CadenceInterval" AS ENUM ('NONE', 'WEEK', 'MONTH');
CREATE TYPE "PlanPriceType" AS ENUM ('PER_VISIT', 'PER_MONTH', 'FLAT');

-- 2. Service: tax in, stored discount label out.
ALTER TABLE "Service" ADD COLUMN "taxRateBps" INTEGER NOT NULL DEFAULT 0;
UPDATE "Service" SET "taxRateBps" = 700;
ALTER TABLE "Service" DROP COLUMN "recurringDiscount";

-- 3. Configuration groups: description + quantity pricing strategy.
ALTER TABLE "ServiceConfigGroup" ADD COLUMN "description" TEXT;
ALTER TABLE "ServiceConfigGroup" ADD COLUMN "unitLabel" TEXT;
ALTER TABLE "ServiceConfigGroup" ADD COLUMN "unitPrice" INTEGER;

-- 4. Global cadences.
CREATE TABLE "RecurringCadence" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "interval" "CadenceInterval" NOT NULL,
    "intervalCount" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "ConfigStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RecurringCadence_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RecurringCadence_key_key" ON "RecurringCadence"("key");

INSERT INTO "RecurringCadence" ("id", "key", "label", "interval", "intervalCount", "sortOrder", "updatedAt") VALUES
  (gen_random_uuid(), 'one-time', 'One-time',       'NONE',  1, 0, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'weekly',   'Weekly',         'WEEK',  1, 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'biweekly', 'Every two weeks','WEEK',  2, 2, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'monthly',  'Monthly',        'MONTH', 1, 3, CURRENT_TIMESTAMP);

-- 5. Per-service cadence rows.
CREATE TABLE "ServiceRecurring" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "cadenceId" TEXT NOT NULL,
    "discountPercent" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ServiceRecurring_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ServiceRecurring_serviceId_cadenceId_key" ON "ServiceRecurring"("serviceId", "cadenceId");
CREATE INDEX "ServiceRecurring_serviceId_idx" ON "ServiceRecurring"("serviceId");
ALTER TABLE "ServiceRecurring" ADD CONSTRAINT "ServiceRecurring_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceRecurring" ADD CONSTRAINT "ServiceRecurring_cadenceId_fkey"
  FOREIGN KEY ("cadenceId") REFERENCES "RecurringCadence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: a full service × cadence grid. One-time is active for every service;
-- recurring cadences activate where the service was recurring-eligible. Percents
-- come from the live frequency discount rules (trigger option key == cadence
-- key), so admin edits made through the old rules editor are preserved.
INSERT INTO "ServiceRecurring" ("id", "serviceId", "cadenceId", "discountPercent", "isActive", "updatedAt")
SELECT
  gen_random_uuid(),
  s."id",
  c."id",
  COALESCE((
    SELECT (r."effect"->>'value')::int
    FROM "ServicePricingRule" r
    WHERE r."serviceId" = s."id"
      AND r."status" = 'ACTIVE'
      AND r."trigger"->>'kind' = 'option_selected'
      AND r."trigger"->>'group' = 'frequency'
      AND r."trigger"->>'option' = c."key"
      AND r."effect"->>'kind' = 'discount'
      AND r."effect"->>'calc' = 'percent'
    LIMIT 1
  ), 0),
  CASE WHEN c."key" = 'one-time' THEN true ELSE s."isRecurringEligible" END,
  CURRENT_TIMESTAMP
FROM "Service" s CROSS JOIN "RecurringCadence" c;

-- 6. Plans.
CREATE TABLE "ServicePlan" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "cadenceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bullets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "price" INTEGER NOT NULL,
    "priceType" "PlanPriceType" NOT NULL DEFAULT 'PER_VISIT',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "ConfigStatus" NOT NULL DEFAULT 'ACTIVE',
    "stripeProductId" TEXT,
    "stripePriceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ServicePlan_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ServicePlan_serviceId_status_sortOrder_idx" ON "ServicePlan"("serviceId", "status", "sortOrder");
ALTER TABLE "ServicePlan" ADD CONSTRAINT "ServicePlan_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServicePlan" ADD CONSTRAINT "ServicePlan_cadenceId_fkey"
  FOREIGN KEY ("cadenceId") REFERENCES "RecurringCadence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 7. The frequency selector is no longer a configuration group (the /book
-- frequency section renders from ServiceRecurring). Options cascade.
DELETE FROM "ServiceConfigGroup" WHERE "key" = 'frequency';

-- 8. Retired tables.
DROP TABLE "ServicePricingRule";
DROP TABLE "ServiceRecurringPlan";
