import type { Prisma } from "@prisma/client";
import { ConfigApplies, ConfigInputType, ConfigStatus } from "../../enums";
import { PRICING_VERSION } from "../../constants";
import type { Modifier, PricingRule, PricingTable, ServicePricing } from "./engine/types";
import { RuleEffectSchema, RuleTriggerSchema } from "./engine/types";

export type ServiceWithPricingRows = Prisma.ServiceGetPayload<{
  include: {
    configGroups: { include: { options: true } };
    pricingRules: true;
  };
}>;

type PriceableInputType = Exclude<ConfigInputType, typeof ConfigInputType.TEXTAREA>;

/** TEXTAREA is intentionally absent: textarea groups NEVER become modifiers. */
const INPUT_TYPE_TO_MODIFIER_TYPE: Record<PriceableInputType, Modifier["type"]> = {
  SELECT: "select",
  MULTISELECT: "multiselect",
  QUANTITY: "quantity",
  TOGGLE: "toggle",
};

/**
 * DB rows -> a single-entry PricingTable keyed by service.pricingRef. Pure
 * mapping; defensively re-filters ACTIVE and re-sorts so correctness never
 * depends on the call site's query shape.
 */
export function buildPricingTable(service: ServiceWithPricingRows): PricingTable {
  const money = (amount: number) => ({ amount, currency: service.currency });

  const modifiers: Modifier[] = service.configGroups
    .filter((g) => g.status === ConfigStatus.ACTIVE && g.inputType !== ConfigInputType.TEXTAREA)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((g) => {
      const activeOptions = g.options
        .filter((o) => o.status === ConfigStatus.ACTIVE)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      return {
        id: g.key, // id-alignment contract: group.key IS the modifier id, verbatim
        label: g.label,
        type: INPUT_TYPE_TO_MODIFIER_TYPE[g.inputType as PriceableInputType],
        applies: g.applies === ConfigApplies.PER_UNIT ? "per_unit" : "flat",
        options: activeOptions.length
          ? activeOptions.map((o) => ({ id: o.key, label: o.label, delta: money(o.priceDelta) }))
          : undefined,
        delta: g.priceDelta != null ? money(g.priceDelta) : undefined,
      } satisfies Modifier;
    });

  const rules: PricingRule[] = service.pricingRules
    .filter((r) => r.status === ConfigStatus.ACTIVE)
    .map((r) => ({
      key: r.key,
      label: r.label,
      // Json columns are re-validated on every build: a malformed row fails
      // loudly here instead of pricing wrong silently.
      trigger: RuleTriggerSchema.parse(r.trigger),
      effect: RuleEffectSchema.parse(r.effect),
      sortOrder: r.sortOrder,
    }));

  const entry: ServicePricing = {
    base_price: money(service.basePrice),
    modifiers,
    fees: [],
    rules,
    mode: "PRICED",
  };

  return {
    version: PRICING_VERSION,
    currency: service.currency,
    services: { [service.pricingRef]: entry },
  };
}
