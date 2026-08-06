/**
 * Payment frequency (RecurringCadence) is "how often the customer pays" — a
 * separate axis from ServicePlan, which is a package of benefits.
 *
 * One-time is a first-class member of the set (interval NONE) rather than a
 * null, so every Booking and Membership carries a cadence and the subscription
 * branch is `cadence.interval !== NONE` instead of a null check. That makes
 * this row load-bearing: it is marked isSystem and cannot be deleted or
 * deactivated through the admin API.
 */
export const ONE_TIME_CADENCE_KEY = "one-time";
