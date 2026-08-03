-- The service-area waitlist form collects a name and phone that had nowhere to
-- land: the form validated all four fields and then discarded them (it never
-- reached the API at all). Both nullable and additive — existing rows are
-- unaffected, and the fields stay optional on the public endpoint so the
-- WAITLISTED arm of POST /bookings, which only has email + zip, still works.
ALTER TABLE "WaitlistSignup" ADD COLUMN "name" TEXT;
ALTER TABLE "WaitlistSignup" ADD COLUMN "phone" TEXT;
