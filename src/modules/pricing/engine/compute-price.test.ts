import { describe, expect, it } from "vitest";
import { computePrice } from "./compute-price";
import { EngineConfigurationSchema, PricingTableSchema } from "./types";

// New-model semantics under test: base is FLAT (the payable minimum, added
// once), option deltas are additive increments, quantity groups price as
// quantity × unit_price, and there is NO rules pass — the recurring cadence %
// is applied by the caller, never inside the engine.

const cleaning = PricingTableSchema.parse({
  version: "apex-pricing.v1",
  currency: "USD",
  services: {
    cleaning: {
      base_price: { amount: 14900, currency: "USD" },
      modifiers: [
        {
          id: "cleaning-type",
          label: "Cleaning Type",
          type: "select",
          options: [
            { id: "standard", label: "Standard", delta: { amount: 0, currency: "USD" } },
            { id: "deep", label: "Deep Clean", delta: { amount: 5000, currency: "USD" } },
          ],
        },
        {
          id: "bedrooms",
          label: "Bedrooms",
          type: "select",
          options: [
            { id: "1", label: "1 bedroom", delta: { amount: 0, currency: "USD" } },
            { id: "3", label: "3 bedrooms", delta: { amount: 5000, currency: "USD" } },
          ],
        },
        {
          id: "extras",
          label: "Add-ons",
          type: "multiselect",
          options: [
            { id: "fridge", label: "Inside fridge", delta: { amount: 2500, currency: "USD" } },
            { id: "oven", label: "Inside oven", delta: { amount: 3000, currency: "USD" } },
          ],
        },
      ],
    },
  },
});

const handyman = PricingTableSchema.parse({
  version: "apex-pricing.v1",
  currency: "USD",
  services: {
    handyman: {
      base_price: { amount: 9500, currency: "USD" },
      modifiers: [
        {
          id: "additional-hours",
          label: "Additional hours",
          type: "quantity",
          unit_price: { amount: 9500, currency: "USD" },
        },
      ],
    },
  },
});

const cfg = (serviceId: string, selections: Record<string, unknown>, quantity = 1) =>
  EngineConfigurationSchema.parse({ service_id: serviceId, selections, quantity });

describe("computePrice — flat base + additive deltas (VERIFIED cents)", () => {
  it("cheapest required configuration costs exactly the base", () => {
    const r = computePrice(cleaning, cfg("cleaning", { "cleaning-type": "standard", bedrooms: "1" }));
    expect(r.line_items[0]).toMatchObject({ kind: "base", amount: { amount: 14900 } });
    expect(r.total.amount).toBe(14900);
  });

  it("deep + 3br + both add-ons = 149 + 50 + 50 + 25 + 30 = $304.00", () => {
    const r = computePrice(
      cleaning,
      cfg("cleaning", { "cleaning-type": "deep", bedrooms: "3", extras: ["fridge", "oven"] }),
    );
    expect(r.subtotal?.amount).toBe(30400);
    expect(r.total.amount).toBe(30400);
  });

  it("$0 options price as Included (no extra line beyond their selection)", () => {
    const r = computePrice(cleaning, cfg("cleaning", { "cleaning-type": "standard" }));
    expect(r.total.amount).toBe(14900);
  });
});

describe("computePrice — quantity groups (quantity × unit_price)", () => {
  it("0 extra hours -> base only", () => {
    // 0 is falsy but not null/false — the engine must not price it (n <= 0 skips).
    expect(computePrice(handyman, cfg("handyman", { "additional-hours": 0 })).total.amount).toBe(9500);
  });

  it("3 extra hours -> 95 + 3×95 = $380.00 with a labelled line", () => {
    const r = computePrice(handyman, cfg("handyman", { "additional-hours": 3 }));
    expect(r.total.amount).toBe(38000);
    expect(r.line_items[1]).toMatchObject({ label: "Additional hours × 3", amount: { amount: 28500 } });
  });

  it("ignores the legacy global quantity multiplier (base stays flat)", () => {
    expect(computePrice(handyman, cfg("handyman", {}, 4)).total.amount).toBe(9500);
  });
});

describe("computePrice — unknown service", () => {
  it("returns a zero price for an unknown service id", () => {
    expect(computePrice(cleaning, cfg("nope", {})).total.amount).toBe(0);
  });
});
