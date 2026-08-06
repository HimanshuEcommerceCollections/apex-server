-- Charge-snapshot discipline for Stripe: every charged amount comes from stored
-- snapshot data, never recomputed at pay time.
--   - BookingConfiguration: taxRateBps as-of-booking + taxAmount + grandTotal
--     (what the PaymentIntent charges). Existing FROM snapshots backfill from
--     the service's CURRENT rate (the closest available approximation — no
--     charges have happened yet, so nothing retroactively moves).
--   - Booking.paymentDueAt: auto-cancel deadline for unpaid FROM bookings
--     (cron sweep). NULL for QUOTE — coordinator-controlled lifecycle.
--   - Payment.taxAmount: the tax portion of `amount`, for reporting.

ALTER TABLE "Booking" ADD COLUMN "paymentDueAt" TIMESTAMP(3);

ALTER TABLE "BookingConfiguration" ADD COLUMN "taxRateBps" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BookingConfiguration" ADD COLUMN "taxAmount" INTEGER;
ALTER TABLE "BookingConfiguration" ADD COLUMN "grandTotal" INTEGER;

ALTER TABLE "Payment" ADD COLUMN "taxAmount" INTEGER NOT NULL DEFAULT 0;

-- Backfill existing snapshots from the service's current tax rate.
UPDATE "BookingConfiguration" bc
SET "taxRateBps" = s."taxRateBps",
    "taxAmount"  = CASE WHEN bc."priceTotal" IS NULL THEN NULL
                        ELSE ROUND(bc."priceTotal" * s."taxRateBps" / 10000.0)::int END,
    "grandTotal" = CASE WHEN bc."priceTotal" IS NULL THEN NULL
                        ELSE bc."priceTotal" + ROUND(bc."priceTotal" * s."taxRateBps" / 10000.0)::int END
FROM "Service" s
WHERE s."id" = bc."serviceId";
