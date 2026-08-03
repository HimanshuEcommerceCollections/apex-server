-- Soft delete for users. Staff offboarding needs a "delete" that is not a row
-- deletion: Booking.customerId, Payment.userId, BookingAssignment.proUserId and
-- CrewMember.proUserId all reference User with ON DELETE RESTRICT, so a hard
-- delete either fails outright or would orphan operational history.
--
-- Nullable and additive: every existing row stays live (deletedAt IS NULL).
-- usersRepository filters on it for every lookup, so a deleted account cannot
-- sign in, resolve a session, or appear in staff listings.
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Staff listings and the login lookup both filter on it.
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");
