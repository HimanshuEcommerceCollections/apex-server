import { z } from "zod";

/**
 * Shared zod primitives for the P14-M2 keyed-selections contract (transport shape).
 */
export const moneySchema = z.object({
  amount: z.number().int(),
  currency: z.string().length(3),
});

export const configValueSchema: z.ZodType<string | number | boolean | string[]> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
]);

export const selectionsSchema = z.record(z.string(), configValueSchema);

export const zipSchema = z.string().regex(/^\d{5}$/, "zip must be a 5-digit ZIP code");

// ---------------------------------------------------------------------------
// Catalog-aware selection validation (layer 2). Pure and brand-neutral: it
// takes plain group descriptors (not Prisma rows) and RETURNS violations rather
// than throwing (shared code never throws ApiError — the config/booking service
// translates violations into a 422). docs/architecture/04 §6, §8.
// ---------------------------------------------------------------------------

export type ConfigInput = "SELECT" | "MULTISELECT" | "QUANTITY" | "TOGGLE" | "TEXTAREA";
export type PricingModeName = "FROM" | "QUOTE";

export interface GroupDescriptor {
  key: string;
  inputType: ConfigInput;
  isRequired: boolean;
  selectMin: number | null;
  selectMax: number | null;
  optionKeys: string[]; // ACTIVE option keys, verbatim
}

export interface SelectionViolation {
  code: string;
  path: string;
  message: string;
}

export interface ValidateSelectionsInput {
  selections: Record<string, unknown>;
  groups: GroupDescriptor[];
  pricingMode: PricingModeName;
  description?: string;
  /** strict = booking submit (enforce required groups + description rules); false = live preview. */
  strict: boolean;
}

const DESCRIPTION_MIN = 10;
const DESCRIPTION_MAX = 2000;

/** Validate keyed selections against a service's groups. Empty array = valid. */
export function validateSelections(input: ValidateSelectionsInput): SelectionViolation[] {
  const { selections, groups, pricingMode, description, strict } = input;
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const violations: SelectionViolation[] = [];

  for (const [key, value] of Object.entries(selections)) {
    const group = byKey.get(key);
    if (!group) {
      violations.push({ code: "UNKNOWN_SELECTION_GROUP", path: key, message: `Unknown group "${key}"` });
      continue;
    }
    if (group.inputType === "TEXTAREA") {
      violations.push({
        code: "TEXTAREA_IN_SELECTIONS",
        path: key,
        message: `"${key}" is a description field — send it as configuration.description, not in selections`,
      });
      continue;
    }
    violations.push(...validateGroupValue(group, value));
  }

  if (strict) {
    for (const g of groups) {
      if (g.inputType === "TEXTAREA" || !g.isRequired) continue;
      const present = selections[g.key];
      const empty = present == null || (Array.isArray(present) && present.length === 0);
      if (empty) {
        violations.push({
          code: "MISSING_REQUIRED_SELECTION",
          path: g.key,
          message: `"${g.key}" is required`,
        });
      }
    }
    violations.push(...validateDescription(pricingMode, description));
  }

  return violations;
}

function validateGroupValue(group: GroupDescriptor, value: unknown): SelectionViolation[] {
  const opts = new Set(group.optionKeys);
  const bad = (code: string, message: string): SelectionViolation[] => [
    { code, path: group.key, message },
  ];

  switch (group.inputType) {
    case "SELECT": {
      if (typeof value !== "string") return bad("INVALID_SELECTION_VALUE", `"${group.key}" expects one option key`);
      if (!opts.has(value)) return bad("UNKNOWN_OPTION_KEY", `"${value}" is not an option of "${group.key}"`);
      return [];
    }
    case "MULTISELECT": {
      if (!Array.isArray(value)) return bad("INVALID_SELECTION_VALUE", `"${group.key}" expects an array of option keys`);
      const out: SelectionViolation[] = [];
      for (const v of value) {
        if (typeof v !== "string" || !opts.has(v)) {
          out.push({ code: "UNKNOWN_OPTION_KEY", path: group.key, message: `"${String(v)}" is not an option of "${group.key}"` });
        }
      }
      if (group.selectMin != null && value.length < group.selectMin) {
        out.push({ code: "SELECT_MIN", path: group.key, message: `Select at least ${group.selectMin}` });
      }
      if (group.selectMax != null && value.length > group.selectMax) {
        out.push({ code: "SELECT_MAX", path: group.key, message: `Select at most ${group.selectMax}` });
      }
      return out;
    }
    case "QUANTITY": {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return bad("INVALID_SELECTION_VALUE", `"${group.key}" expects an integer`);
      }
      if (!opts.has(String(value))) return bad("UNKNOWN_OPTION_KEY", `${value} is out of range for "${group.key}"`);
      return [];
    }
    case "TOGGLE": {
      if (typeof value !== "boolean") return bad("INVALID_SELECTION_VALUE", `"${group.key}" expects a boolean`);
      return [];
    }
    default:
      return [];
  }
}

function validateDescription(mode: PricingModeName, description?: string): SelectionViolation[] {
  const text = description?.trim() ?? "";
  if (mode === "QUOTE") {
    if (text.length < DESCRIPTION_MIN || text.length > DESCRIPTION_MAX) {
      return [
        {
          code: "QUOTE_DESCRIPTION_REQUIRED",
          path: "description",
          message: `A project description of ${DESCRIPTION_MIN}-${DESCRIPTION_MAX} characters is required`,
        },
      ];
    }
    return [];
  }
  if (text.length > 0) {
    return [
      {
        code: "DESCRIPTION_NOT_ALLOWED",
        path: "description",
        message: "This service is priced; put free text in booking notes, not configuration.description",
      },
    ];
  }
  return [];
}
