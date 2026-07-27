/**
 * Pure booking-reference formatter: (brandCode, year, seq) -> "APX-2026-0042".
 * Counter persistence stays in bookings.repository.ts; this only formats.
 * Fully parameterized (no brand constants imported) so a future brand reuses it.
 */
export function formatBookingReference(
  brandCode: string,
  year: number,
  seq: number,
  pad = 4,
): string {
  return `${brandCode}-${year}-${String(seq).padStart(pad, "0")}`;
}
