-- MembershipPlan merges into ServicePlan — one Plans entity. A plan's billing
-- cycle comes from its RecurringCadence and its price is the BINDING per-cycle
-- amount (the old fromPrice was a display teaser; the migrated values become
-- binding, admin-tunable in /admin/plans).
--
-- Feature bullets: the marketing /membership-plans page carried these as static
-- client copy; they are seeded here per service so the migrated plans arrive
-- complete and the page can render them from data.
--
-- Membership.planId keeps its VALUES (plan rows migrate id-preserving) — only
-- the FK retargets to ServicePlan. No live memberships exist (Stripe was never
-- wired), but the id-preserving copy makes this safe even if some did.

-- 1. Quarterly cadence (power-washing's old MONTH/3 interval needs it). Fans out
--    to every service's grid, inactive at 0%, like any admin-created cadence.
INSERT INTO "RecurringCadence" ("id", "key", "label", "interval", "intervalCount", "sortOrder", "updatedAt")
SELECT gen_random_uuid(), 'quarterly', 'Every 3 months', 'MONTH', 3,
       (SELECT COALESCE(MAX("sortOrder"), 0) + 1 FROM "RecurringCadence"),
       CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "RecurringCadence" WHERE "key" = 'quarterly');

INSERT INTO "ServiceRecurring" ("id", "serviceId", "cadenceId", "discountPercent", "isActive", "updatedAt")
SELECT gen_random_uuid(), s."id", c."id", 0, false, CURRENT_TIMESTAMP
FROM "Service" s
JOIN "RecurringCadence" c ON c."key" = 'quarterly'
WHERE NOT EXISTS (
  SELECT 1 FROM "ServiceRecurring" r WHERE r."serviceId" = s."id" AND r."cadenceId" = c."id"
);

-- 2. Migrate plans, id-preserving. fromPrice becomes the binding price; rows
--    without one cannot be priced plans and are dropped (none exist live).
INSERT INTO "ServicePlan"
  ("id", "serviceId", "cadenceId", "name", "bullets", "price", "priceType",
   "featured", "sortOrder", "status", "stripeProductId", "stripePriceId", "createdAt", "updatedAt")
SELECT
  mp."id",
  mp."serviceId",
  c."id",
  mp."name",
  CASE s."slug"
    WHEN 'cleaning' THEN ARRAY['Same trusted 2-person team', 'Kitchen, baths & all rooms', 'Free re-clean guarantee', 'Supplies included']
    WHEN 'lawn-care' THEN ARRAY['Mow, edge, trim & blow', 'Seasonal height adjustments', 'Priority weather rescheduling', 'Same crew each visit']
    WHEN 'pool' THEN ARRAY['Skim, vacuum & brush', 'Chemical balancing', 'Equipment health check', 'Filter maintenance']
    WHEN 'power-washing' THEN ARRAY['Driveways, siding & decks', 'Surface-safe pressure', 'Free re-wash guarantee', 'Bundle & save rates']
    ELSE ARRAY[]::TEXT[]
  END,
  mp."fromPrice",
  'PER_VISIT'::"PlanPriceType",
  false,
  mp."sortOrder",
  CASE WHEN mp."active" THEN 'ACTIVE'::"ConfigStatus" ELSE 'INACTIVE'::"ConfigStatus" END,
  mp."stripeProductId",
  mp."stripeAnchorPriceId",
  mp."createdAt",
  CURRENT_TIMESTAMP
FROM "MembershipPlan" mp
JOIN "Service" s ON s."id" = mp."serviceId"
JOIN "RecurringCadence" c ON c."key" = CASE
  WHEN mp."interval" = 'WEEK' AND mp."intervalCount" = 1 THEN 'weekly'
  WHEN mp."interval" = 'WEEK' AND mp."intervalCount" = 2 THEN 'biweekly'
  WHEN mp."interval" = 'MONTH' AND mp."intervalCount" = 1 THEN 'monthly'
  WHEN mp."interval" = 'MONTH' AND mp."intervalCount" = 3 THEN 'quarterly'
END
WHERE mp."fromPrice" IS NOT NULL;

-- 3. Retarget the Membership FK (values unchanged — ids were preserved).
ALTER TABLE "Membership" DROP CONSTRAINT "Membership_planId_fkey";
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "ServicePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Retire the old entity.
DROP TABLE "MembershipPlan";
DROP TYPE "MembershipInterval";
