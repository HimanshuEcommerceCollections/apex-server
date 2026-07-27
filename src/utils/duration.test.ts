import { describe, expect, it } from "vitest";
import { parseDurationMs } from "./duration";

describe("parseDurationMs", () => {
  it("parses s/m/h/d units", () => {
    expect(parseDurationMs("30s")).toBe(30_000);
    expect(parseDurationMs("15m")).toBe(900_000);
    expect(parseDurationMs("1h")).toBe(3_600_000);
    expect(parseDurationMs("7d")).toBe(604_800_000);
  });
  it("throws on malformed input", () => {
    expect(() => parseDurationMs("soon")).toThrow();
    expect(() => parseDurationMs("10")).toThrow();
  });
});
