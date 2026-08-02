-- The Become-an-Apex-Pro form collects applicant profile detail that had nowhere
-- to land: years of experience, business name, availability, preferred start and
-- a short introduction. All nullable and additive — existing rows are unaffected,
-- and the fields stay optional on the public endpoint.
ALTER TABLE "ProApplication" ADD COLUMN "experience" TEXT;
ALTER TABLE "ProApplication" ADD COLUMN "company" TEXT;
ALTER TABLE "ProApplication" ADD COLUMN "availability" TEXT;
ALTER TABLE "ProApplication" ADD COLUMN "preferredStart" TEXT;
ALTER TABLE "ProApplication" ADD COLUMN "intro" TEXT;
