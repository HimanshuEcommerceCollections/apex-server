/** Non-DB enums (not persisted; app-level vocabulary). */

/** The POST /bookings discriminated-union tag (docs/architecture/06). */
export enum BookingOutcome {
  BOOKED = "BOOKED",
  WAITLISTED = "WAITLISTED",
}

export enum SortOrder {
  ASC = "asc",
  DESC = "desc",
}
