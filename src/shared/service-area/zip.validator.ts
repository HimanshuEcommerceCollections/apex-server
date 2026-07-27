/** Pure zip helpers — no DB, no Apex imports. */

export function isValidZipFormat(zip: string): boolean {
  return /^\d{5}$/.test(zip);
}

/** True when `zip` is in the active allowlist. */
export function isZipEligible(zip: string, activeZips: Iterable<string>): boolean {
  const set = activeZips instanceof Set ? activeZips : new Set(activeZips);
  return set.has(zip);
}
