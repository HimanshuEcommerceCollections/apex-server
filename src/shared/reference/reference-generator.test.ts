import { describe, expect, it } from "vitest";
import { formatBookingReference } from "./reference-generator";

describe("formatBookingReference", () => {
  it("zero-pads the sequence to 4 digits by default", () => {
    expect(formatBookingReference("APX", 2026, 42)).toBe("APX-2026-0042");
    expect(formatBookingReference("APX", 2026, 1)).toBe("APX-2026-0001");
  });

  it("widens past 9999 without truncating", () => {
    expect(formatBookingReference("APX", 2026, 12345)).toBe("APX-2026-12345");
  });

  it("is brand-parameterized for future brands", () => {
    expect(formatBookingReference("ELV", 2027, 7, 5)).toBe("ELV-2027-00007");
  });
});
