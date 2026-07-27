const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Parse a short duration string ("15m", "7d", "1h", "30s") into milliseconds. */
export function parseDurationMs(value: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(value.trim());
  if (!match) throw new Error(`Invalid duration: "${value}" (expected e.g. "15m", "7d")`);
  return Number(match[1]) * UNIT_MS[match[2]];
}
