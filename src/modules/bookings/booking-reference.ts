import type { Prisma } from "@prisma/client";
import { formatBookingReference } from "../../shared";

/**
 * Allocate the next reference for a brand+year. MUST run inside the caller's
 * transaction (the same tx that inserts the Booking), so the increment commits
 * and rolls back atomically. The ON CONFLICT DO UPDATE holds a row lock that
 * serializes concurrent bookings — duplicates are impossible by construction.
 */
export async function nextBookingReference(
  tx: Prisma.TransactionClient,
  brandCode: string,
  now: Date = new Date(),
): Promise<string> {
  const year = now.getUTCFullYear();
  const row = await tx.bookingReferenceCounter.upsert({
    where: { brandCode_year: { brandCode, year } },
    create: { brandCode, year, counter: 1 },
    update: { counter: { increment: 1 } },
    select: { counter: true },
  });
  return formatBookingReference(brandCode, year, row.counter);
}
