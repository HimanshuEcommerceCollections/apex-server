import { describe, expect, it } from "vitest";
import { resolveProviderName } from "./email.service";

describe("resolveProviderName (provider-agnostic selection)", () => {
  it("uses Resend when selected and keyed", () => {
    expect(resolveProviderName({ provider: "resend", hasResendKey: true, hasSmtp: false })).toBe(
      "resend",
    );
  });

  it("uses SMTP when selected and configured", () => {
    expect(resolveProviderName({ provider: "smtp", hasResendKey: false, hasSmtp: true })).toBe(
      "smtp",
    );
  });

  it("falls back to console when the selected provider is not configured", () => {
    expect(resolveProviderName({ provider: "resend", hasResendKey: false, hasSmtp: false })).toBe(
      "console",
    );
    expect(resolveProviderName({ provider: "smtp", hasResendKey: false, hasSmtp: false })).toBe(
      "console",
    );
  });
});
