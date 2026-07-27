import { describe, expect, it } from "vitest";
import { assertPriceIntegrity } from "./pricing.service";
import { quoteHandler } from "./modes/quote.handler";
import { PricingMode } from "../../enums";
import { PricingTableSchema, EngineConfigurationSchema, type DisplayedPrice } from "./engine/types";
import type { PricingModeContext } from "./modes/handler.types";

function code(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (e) {
    return (e as { details?: { code?: string } }).details?.code;
  }
}

const priced = (amount: number): DisplayedPrice => ({
  total: { amount, currency: "USD" },
  subtotal: { amount, currency: "USD" },
  line_items: [],
  pricing_version: "apex-pricing.v1",
  is_estimate: true,
});

describe("assertPriceIntegrity (the recompute guard)", () => {
  it("passes when totals match", () => {
    expect(() => assertPriceIntegrity(priced(16000), priced(16000))).not.toThrow();
  });

  it("throws PRICE_MISMATCH when the client total disagrees", () => {
    expect(code(() => assertPriceIntegrity(priced(16000), priced(999)))).toBe("PRICE_MISMATCH");
  });

  it("throws QUOTE_PRICE_NOT_ALLOWED when a QUOTE recompute carries a client price", () => {
    expect(code(() => assertPriceIntegrity(null, priced(100)))).toBe("QUOTE_PRICE_NOT_ALLOWED");
  });

  it("accepts a missing client price (recompute stands alone)", () => {
    expect(() => assertPriceIntegrity(priced(16000), null)).not.toThrow();
  });
});

describe("quoteHandler.recompute", () => {
  const ctx = (description?: string): PricingModeContext => ({
    service: {
      id: "s1",
      slug: "painting",
      pricingRef: "painting",
      pricingMode: PricingMode.QUOTE,
      fromPrice: null,
      currency: "USD",
    },
    table: PricingTableSchema.parse({ version: "v", currency: "USD", services: {} }),
    configuration: EngineConfigurationSchema.parse({ service_id: "painting", description }),
  });

  it("demands a description of at least 10 chars", () => {
    expect(code(() => quoteHandler.recompute(ctx("short")))).toBe("QUOTE_DESCRIPTION_REQUIRED");
    expect(code(() => quoteHandler.recompute(ctx(undefined)))).toBe("QUOTE_DESCRIPTION_REQUIRED");
  });

  it("returns null (never a price) once a description is present", () => {
    expect(quoteHandler.recompute(ctx("Repaint two bedrooms and the hallway"))).toBeNull();
  });
});
