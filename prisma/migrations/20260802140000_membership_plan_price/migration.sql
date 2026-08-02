-- Display-only member pricing on MembershipPlan; Stripe fields become optional so
-- a plan can exist for the marketing catalog before it's wired to Stripe.
ALTER TABLE "MembershipPlan" ADD COLUMN "fromPrice" INTEGER;
ALTER TABLE "MembershipPlan" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE "MembershipPlan" ALTER COLUMN "stripeProductId" DROP NOT NULL;
ALTER TABLE "MembershipPlan" ALTER COLUMN "stripeAnchorPriceId" DROP NOT NULL;
