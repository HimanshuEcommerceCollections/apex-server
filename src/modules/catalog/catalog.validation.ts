import { z } from "zod";

const MAX_CENTS = 2_000_000; // $20,000 ceiling on any single delta / base price
const MAX_TAX_BPS = 2_000; // 20% ceiling on a service tax rate

/**
 * Integer amount that refuses to invent a value out of nothing.
 *
 * `z.coerce.number()` alone is unsafe for money: it turns null into 0, so a
 * client that computes NaN (Number("Apple") * 100) and serialises it — JSON has
 * no NaN, it becomes null — silently saves a $0 base price as a success. $0
 * means "no from-price shown" on the site, so a typo quietly delists a price.
 * Mapping the empty-ish inputs to NaN makes .int() reject them instead.
 */
const amount = (max: number) =>
  z.preprocess(
    (v) => (v === null || v === "" || typeof v === "boolean" ? NaN : v),
    z.coerce.number().int().min(0).max(max),
  );

export const catalogServiceParamSchema = z.object({ idOrSlug: z.string().min(1) });
export const idParamSchema = z.object({ id: z.string().uuid() });
export const groupParamSchema = z.object({ idOrSlug: z.string().min(1), groupId: z.string().uuid() });

export const updatePricingSchema = z
  .object({
    // FROM = binding, paid at booking; QUOTE = coordinator sets the final amount
    // (the engine total is indicative). Switching mode changes how /book charges.
    pricingMode: z.enum(["FROM", "QUOTE"]).optional(),
    // basePrice is the payable minimum AND the listed "from $X" (0 = none shown).
    basePrice: amount(MAX_CENTS).optional(),
    taxRateBps: amount(MAX_TAX_BPS).optional(),
    typicalDuration: z.string().trim().max(40).nullable().optional(),
    // Bulk delta editor (deltas only — labels/status go through the option PATCH).
    options: z.array(z.object({ id: z.string().uuid(), priceDelta: amount(MAX_CENTS) })).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "At least one field is required" });

// ── Configurations (groups + options) ─────────────────────────────────────────

const groupBase = {
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).nullable().optional(),
  isRequired: z.boolean().optional(),
  selectMin: z.coerce.number().int().min(0).max(50).nullable().optional(),
  selectMax: z.coerce.number().int().min(1).max(50).nullable().optional(),
  quantityMin: z.coerce.number().int().min(0).max(999).nullable().optional(),
  quantityMax: z.coerce.number().int().min(1).max(999).nullable().optional(),
  unitLabel: z.string().trim().max(30).nullable().optional(),
  // .nullable() short-circuits before the amount() preprocess, so an explicit
  // null still clears the field — only NaN-ish junk is rejected.
  unitPrice: amount(MAX_CENTS).nullable().optional(),
};

export const createGroupSchema = z
  .object({
    ...groupBase,
    // What admins create: choose-one, choose-many, or unit-priced quantity.
    inputType: z.enum(["SELECT", "MULTISELECT", "QUANTITY"]),
  })
  .refine((d) => d.inputType !== "QUANTITY" || (d.unitPrice != null && !!d.unitLabel?.length), {
    message: "Quantity configurations need a unit label and a unit price",
  });

export const patchGroupSchema = z
  .object({
    ...groupBase,
    label: groupBase.label.optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
    sortOrder: z.coerce.number().int().min(0).max(999).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "At least one field is required" });

export const createOptionSchema = z.object({
  label: z.string().trim().min(1).max(80),
  sublabel: z.string().trim().max(120).nullable().optional(),
  priceDelta: amount(MAX_CENTS).default(0),
});

export const patchOptionSchema = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    sublabel: z.string().trim().max(120).nullable().optional(),
    priceDelta: amount(MAX_CENTS).optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
    sortOrder: z.coerce.number().int().min(0).max(999).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "At least one field is required" });

// ── Recurring (per-service cadence grid) ──────────────────────────────────────

/** Replace-all editor: one row per cadence the admin wants to set. */
export const putRecurringSchema = z.object({
  rows: z
    .array(
      z.object({
        cadenceId: z.string().uuid(),
        discountPercent: amount(100),
        isActive: z.boolean(),
      }),
    )
    .min(1)
    .max(50),
});

// ── Global cadences ───────────────────────────────────────────────────────────

export const createCadenceSchema = z.object({
  label: z.string().trim().min(1).max(40),
  interval: z.enum(["NONE", "WEEK", "MONTH"]),
  intervalCount: z.coerce.number().int().min(1).max(52).default(1),
});

export const patchCadenceSchema = z
  .object({
    label: z.string().trim().min(1).max(40).optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
    sortOrder: z.coerce.number().int().min(0).max(999).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "At least one field is required" });

// ── Plans ─────────────────────────────────────────────────────────────────────

const planBase = {
  name: z.string().trim().min(1).max(60),
  bullets: z.array(z.string().trim().min(1).max(80)).max(4).default([]),
  // The BINDING pre-tax billing amount — subscribing to a plan charges exactly this.
  price: amount(MAX_CENTS),
  priceType: z.enum(["PER_VISIT", "PER_MONTH", "FLAT"]).default("PER_VISIT"),
  featured: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(999).optional(),
};

export const createPlanSchema = z.object({
  serviceId: z.string().uuid(),
  cadenceId: z.string().uuid(),
  ...planBase,
});

export const patchPlanSchema = z
  .object({
    cadenceId: z.string().uuid().optional(),
    ...planBase,
    name: planBase.name.optional(),
    bullets: z.array(z.string().trim().min(1).max(80)).max(4).optional(),
    price: amount(MAX_CENTS).optional(),
    priceType: z.enum(["PER_VISIT", "PER_MONTH", "FLAT"]).optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "At least one field is required" });
