import { describe, expect, it } from "vitest";
import { computePrice } from "./compute-price";
import { EngineConfigurationSchema, PricingTableSchema } from "./types";

const cleaning = PricingTableSchema.parse({
  version: "apex-pricing.v1",
  currency: "USD",
  services: {
    cleaning: {
      base_price: { amount: 0, currency: "USD" },
      modifiers: [
        {
          id: "cleaning-type",
          label: "Cleaning Type",
          type: "select",
          options: [
            { id: "standard", label: "Standard", delta: { amount: 9500, currency: "USD" } },
            { id: "deep", label: "Deep Clean", delta: { amount: 14500, currency: "USD" } },
          ],
        },
        {
          id: "bedrooms",
          label: "Bedrooms",
          type: "select",
          options: [{ id: "3", label: "3 bedrooms", delta: { amount: 7500, currency: "USD" } }],
        },
        {
          id: "bathrooms",
          label: "Bathrooms",
          type: "select",
          options: [{ id: "2", label: "2 bathrooms", delta: { amount: 3000, currency: "USD" } }],
        },
        {
          id: "frequency",
          label: "Frequency",
          type: "select",
          options: [
            { id: "one-time", label: "One-time", delta: { amount: 0, currency: "USD" } },
            { id: "weekly", label: "Weekly", delta: { amount: 0, currency: "USD" } },
          ],
        },
      ],
      rules: [
        {
          key: "freq-weekly-discount",
          label: "Weekly plan discount",
          trigger: { kind: "option_selected", group: "frequency", option: "weekly" },
          effect: { kind: "discount", calc: "percent", value: 20 },
          sortOrder: 1,
        },
      ],
    },
  },
});

const smart = PricingTableSchema.parse({
  version: "apex-pricing.v1",
  currency: "USD",
  services: {
    "smart-home": {
      base_price: { amount: 0, currency: "USD" },
      modifiers: [
        {
          id: "devices",
          label: "Devices",
          type: "multiselect",
          options: [
            { id: "smart-plug-hub", label: "Smart plug / hub", delta: { amount: 4900, currency: "USD" } },
            { id: "video-doorbell", label: "Video doorbell", delta: { amount: 9900, currency: "USD" } },
            { id: "security-camera", label: "Security camera", delta: { amount: 11900, currency: "USD" } },
          ],
        },
      ],
      rules: [
        {
          key: "multi-device-discount",
          label: "Multi-device discount",
          trigger: { kind: "min_selected", group: "devices", count: 3 },
          effect: { kind: "discount", calc: "percent", value: 15 },
          sortOrder: 1,
        },
      ],
    },
  },
});

const cfg = (serviceId: string, selections: Record<string, unknown>, quantity = 1) =>
  EngineConfigurationSchema.parse({ service_id: serviceId, selections, quantity });

describe("computePrice — cleaning matrix (VERIFIED cents)", () => {
  it("standard + 3br + 2ba + weekly = $160.00 (20000 subtotal, −20%)", () => {
    const r = computePrice(
      cleaning,
      cfg("cleaning", { "cleaning-type": "standard", bedrooms: "3", bathrooms: "2", frequency: "weekly" }),
    );
    expect(r.subtotal?.amount).toBe(20000);
    expect(r.total.amount).toBe(16000);
    expect(r.line_items.at(-1)).toMatchObject({ kind: "discount", amount: { amount: -4000 } });
  });

  it("one-time frequency applies no discount", () => {
    const r = computePrice(
      cleaning,
      cfg("cleaning", { "cleaning-type": "standard", bedrooms: "3", bathrooms: "2", frequency: "one-time" }),
    );
    expect(r.total.amount).toBe(20000);
  });

  it("emits a $0 base line item and priced option lines", () => {
    const r = computePrice(cleaning, cfg("cleaning", { "cleaning-type": "deep" }));
    expect(r.line_items[0]).toMatchObject({ kind: "base", amount: { amount: 0 } });
    expect(r.total.amount).toBe(14500);
  });
});

describe("computePrice — smart-home multi-device threshold (fires at >= 3)", () => {
  it("2 devices -> no discount", () => {
    const r = computePrice(smart, cfg("smart-home", { devices: ["smart-plug-hub", "video-doorbell"] }));
    expect(r.subtotal?.amount).toBe(14800);
    expect(r.total.amount).toBe(14800);
  });

  it("exactly 3 devices -> 15% off (26700 -> 22695)", () => {
    const r = computePrice(
      smart,
      cfg("smart-home", { devices: ["smart-plug-hub", "video-doorbell", "security-camera"] }),
    );
    expect(r.subtotal?.amount).toBe(26700);
    expect(r.total.amount).toBe(22695);
  });
});

describe("computePrice — quantity + unknown service", () => {
  it("scales the base by quantity", () => {
    const t = PricingTableSchema.parse({
      version: "v",
      currency: "USD",
      services: { x: { base_price: { amount: 5000, currency: "USD" } } },
    });
    expect(computePrice(t, cfg("x", {}, 3)).total.amount).toBe(15000);
  });

  it("returns a zero price for an unknown service id", () => {
    expect(computePrice(cleaning, cfg("nope", {})).total.amount).toBe(0);
  });
});
