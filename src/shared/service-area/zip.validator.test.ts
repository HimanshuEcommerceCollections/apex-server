import { describe, expect, it } from "vitest";
import { isValidZipFormat, isZipEligible } from "./zip.validator";

describe("isValidZipFormat", () => {
  it("accepts 5-digit zips only", () => {
    expect(isValidZipFormat("27513")).toBe(true);
    expect(isValidZipFormat("2751")).toBe(false);
    expect(isValidZipFormat("275133")).toBe(false);
    expect(isValidZipFormat("abcde")).toBe(false);
  });
});

describe("isZipEligible", () => {
  const allowlist = ["27513", "27601", "27540"];
  it("is true only for zips in the active allowlist", () => {
    expect(isZipEligible("27513", allowlist)).toBe(true);
    expect(isZipEligible("99999", allowlist)).toBe(false);
  });
  it("accepts a Set as well as an array", () => {
    expect(isZipEligible("27601", new Set(allowlist))).toBe(true);
  });
});
