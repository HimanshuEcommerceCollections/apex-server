import { z } from "zod";

/** Money in integer MINOR units (cents). Mirrors the P14-M2 contract MoneySchema. */
export const MoneySchema = z.object({
  amount: z.number().int(),
  currency: z.string().length(3),
});
export type Money = z.infer<typeof MoneySchema>;

export const LineItemSchema = z.object({
  label: z.string(),
  amount: MoneySchema,
  kind: z.enum(["base", "modifier", "option", "fee", "discount"]),
});
export type LineItem = z.infer<typeof LineItemSchema>;

export const DisplayedPriceSchema = z.object({
  total: MoneySchema,
  subtotal: MoneySchema.optional(),
  line_items: z.array(LineItemSchema).default([]),
  pricing_version: z.string(),
  is_estimate: z.boolean().default(true),
});
export type DisplayedPrice = z.infer<typeof DisplayedPriceSchema>;

const ConfigValue = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);

/**
 * P14-M2 Configuration shape plus Apex's optional `description` (QUOTE project
 * text). `description` never participates in math; it is carried so the QUOTE
 * handler can demand it at booking time.
 */
export const EngineConfigurationSchema = z.object({
  service_id: z.string(),
  selections: z.record(z.string(), ConfigValue).default({}),
  quantity: z.number().int().positive().default(1),
  variant_id: z.string().optional(),
  description: z.string().optional(),
});
export type EngineConfiguration = z.infer<typeof EngineConfigurationSchema>;
export type Selections = EngineConfiguration["selections"];

// ── Pricing-table shapes (port of Client/src/lib/pricing/types.ts) ─────────────

export const ModifierType = z.enum(["select", "multiselect", "quantity", "toggle"]);

export const ModifierOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  delta: MoneySchema,
});

export const ModifierSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: ModifierType,
  applies: z.enum(["per_unit", "flat"]).default("flat"),
  options: z.array(ModifierOptionSchema).optional(),
  delta: MoneySchema.optional(),
});

export const FeeSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["fee", "discount"]).default("fee"),
  calc: z.enum(["flat", "percent"]),
  value: z.number(),
});

// ── Apex extension: conditional rules (ServicePricingRule.trigger / .effect) ───

export const MinSelectedTriggerSchema = z.object({
  kind: z.literal("min_selected"),
  group: z.string(),
  count: z.number().int().positive(),
});

export const OptionSelectedTriggerSchema = z.object({
  kind: z.literal("option_selected"),
  group: z.string(),
  option: z.string(),
});

export const RuleTriggerSchema = z.discriminatedUnion("kind", [
  MinSelectedTriggerSchema,
  OptionSelectedTriggerSchema,
]);
export type RuleTrigger = z.infer<typeof RuleTriggerSchema>;

export const RuleEffectSchema = z.object({
  kind: z.enum(["fee", "discount"]),
  calc: z.enum(["flat", "percent"]),
  value: z.number(),
});
export type RuleEffect = z.infer<typeof RuleEffectSchema>;

export const PricingRuleSchema = z.object({
  key: z.string(),
  label: z.string(),
  trigger: RuleTriggerSchema,
  effect: RuleEffectSchema,
  sortOrder: z.number().int().default(0),
});
export type PricingRule = z.infer<typeof PricingRuleSchema>;

/**
 * One service's pricing entry. `rules` is the Apex extension. `mode` and
 * `from_price` are SEED-ONLY fields (the engine never consults them); they live
 * here so PricingTableSchema.parse validates the whole seed file in one pass.
 */
export const ServicePricingSchema = z.object({
  base_price: MoneySchema,
  modifiers: z.array(ModifierSchema).default([]),
  fees: z.array(FeeSchema).default([]),
  rules: z.array(PricingRuleSchema).default([]),
  mode: z.enum(["PRICED", "FROM", "QUOTE"]).default("PRICED"),
  from_price: MoneySchema.optional(),
});
export type ServicePricing = z.infer<typeof ServicePricingSchema>;

/** Schema of prisma/seed-data/apex-pricing.v1.json AND the runtime engine input. */
export const PricingTableSchema = z.object({
  version: z.string(),
  currency: z.string().length(3),
  note: z.string().optional(),
  services: z.record(z.string(), ServicePricingSchema),
});
export type PricingTable = z.infer<typeof PricingTableSchema>;

export type Modifier = z.infer<typeof ModifierSchema>;
export type ModifierOption = z.infer<typeof ModifierOptionSchema>;
export type Fee = z.infer<typeof FeeSchema>;
