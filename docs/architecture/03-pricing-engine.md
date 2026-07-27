# Pricing engine and per-service pricing strategy

Section 03 of the Apex Total Home Services backend architecture. Covers deliverables 3 (a pricing
engine supporting PRICED / FROM / QUOTE without hardcoded per-service logic) and 7 (how each of the
11 services plugs in as data -- registry dispatch, no giant switch).

Assumed sibling sections (referenced, not duplicated): 01-foundations.md, 02-database.md
(Prisma schema: `Service`, `ServiceConfigGroup`, `ServiceConfigOption`, `ServicePricingRule`,
`BookingConfiguration`), 04-configuration-engine.md (input types, selection validator),
05-api-and-validation.md (routes and envelopes), 05-api-and-validation.md (zod + reference validation),
06-pipeline-shared-roadmap.md (the `POST /bookings` pipeline that consumes the recompute).

All money in this document and in the system is **integer cents (minor units)**. There is no float
money anywhere: not in the database, not in the engine, not on the wire.

## 1. Scope and position in the architecture

`modules/pricing` is a **routeless internal module** (Elevate precedent: `modules/notifications`
ships only `.service` + `.repository`, no routes/controller). It has exactly two consumers:

| Consumer | Entry point | Purpose |
|---|---|---|
| `modules/services/config` | `pricingService.preview(idOrSlug, input)` | Step-3 live price behind `POST /api/v1/services/:idOrSlug/config/price` |
| `modules/bookings` | `pricingService.recomputeForBooking(idOrSlug, input, clientPrice)` | Authoritative server-side recompute inside `POST /bookings` (the integrity guard) |

```
POST /services/:idOrSlug/config/price            POST /bookings
        (Step 3 live price)                     (Core Flow submit)
                |                                       |
     services/config controller                bookings.service (pipeline)
                |                                       |
      pricingService.preview()            pricingService.recomputeForBooking()
                 \                                     /
                  +----------- buildContext ----------+
                  |  pricing.repository: Service +    |
                  |  ACTIVE groups/options/rules      |
                  |  buildPricingTable: rows -> data  |
                  +----------------+------------------+
                                   |
                 getPricingModeHandler(service.pricingMode)
                     |                |                |
               pricedHandler     fromHandler      quoteHandler
                     |                |                |
               computePrice     computePrice      (no engine run)
               base*qty -> modifiers -> rules -> fees
```

Two deviations from Elevate are load-bearing here and are called out where they bite:

- **Deviation: server-side pricing engine (pinned deviation 2)** -- Elevate's server computes
  `base + sum(option.priceModifier)` ("Option A") and keeps the rich engine client-side; Apex ports
  the rich engine (`Client/src/lib/pricing/engine.ts`) to the server and extends it with a
  conditional-rules pass -- justified because matrix, percent-discount, and threshold pricing
  cannot be expressed additively, and the server recompute is the only integrity guard.
- **Deviation: preview body `{ selections, quantity }` (pinned deviation 4)** -- Elevate's preview
  takes `{ optionIds: string[] }`; Apex takes keyed selections per the P14-M2 contract
  (`selections[group.key] = option.key | option.key[] | number | boolean | string`) -- justified
  because matrix and quantity semantics need to know WHICH group a value belongs to.

Also relevant: per pinned deviation 3 (anonymous booking), the preview endpoint is public and
rate-limited; there is no staff-aware pricing path -- only ACTIVE services/groups/options/rules
ever price.

## 2. The four-step computation and where rules sit

Ground truth is Elevate `Client/src/lib/pricing/engine.ts` (verified against source). Its order:

1. `subtotal = base_price * quantity`; push line item kind `base`.
2. Modifier loop: for each modifier, normalize the selection to an array, resolve
   `delta = option.delta ?? modifier.delta`, scale by quantity when `applies === "per_unit"`,
   accumulate into `subtotal`, push line item kind `option` (group has options) or `modifier`.
3. Fee loop: `base = calc === "percent" ? Math.round(subtotal.amount * value / 100) : value`;
   negate for `kind === "discount"`; accumulate into `total` (NOT subtotal); push line item.

Apex inserts exactly one pass -- **conditional rules -- between the modifier loop and the fee
loop**: `base*quantity -> modifiers -> [rules] -> fees`. Rules produce standard `fee | discount`
line items; the P14-M2 `LineItem.kind` vocabulary (`base | modifier | option | fee | discount`) is
unchanged.

### 2.1 Evaluation-order decision

| Decision | Choice (pinned) | Rejected alternatives and why |
|---|---|---|
| Where rules run | A discrete pass after the modifier loop, before the fee loop | (a) Merged into the fee loop: rule/fee interleaving would depend on array position in seed data, and the fee loop would no longer be a byte-identical Elevate port. (b) After fees: discounts would apply to fees, contradicting "15% off your service" copy. |
| Percent base for rules | The **modifier-final subtotal** -- the same frozen value Elevate's fee loop uses (`subtotal` stops accumulating after step 2) | Running post-rule total: percent rules would compound and become order-sensitive; a "15% discount" would no longer be 15% of anything a customer can see. |
| Rounding | `Math.round(subtotal.amount * value / 100)` -- the identical expression and rounding function as the Elevate fee loop; one rounding point per percent line item | Banker's rounding or floor: would break bit-for-bit parity with the published engine. |
| Rule ordering | `sortOrder` ascending, tie-broken by `key` ascending (`localeCompare`) | Insertion/DB order: nondeterministic across replays and seeds. |
| Do rule amounts mutate `subtotal`? | No. Rules accumulate into `total` only, exactly like fees | Mutating subtotal would change the base of later percent rules AND of every percent fee, silently breaking Elevate fee semantics. |

Because every percent (rule or fee) computes against the same frozen subtotal, percent effects are
**non-compounding and commutative**: `sortOrder` affects only line-item display order, never the
total. This is deliberate -- a future compounding requirement would be a new `RuleEffect.calc`
value, not a reordering.

Parity guarantee: a service with `rules: []` produces output **byte-identical** to the Elevate
client engine, with exactly one deliberate cosmetic exception: the base line-item label (`"Base"`
here vs Elevate's hardcoded `"Base (Sample)"` -- see the fidelity table in 4.3). The parity test
suite replays Elevate's `pricing.v1.json` fixtures through the port and deep-equals recorded
client-engine output after normalizing that one label; totals, subtotals, amounts, kinds, and
every non-base label are compared verbatim.

## 3. Module layout

```
src/modules/pricing/
├─ index.ts                    barrel: pricingService + engine types (routeless -- no router)
├─ pricing.service.ts          PricingService (preview / recomputeForBooking) + assertPriceIntegrity
├─ pricing.repository.ts       the ONLY Prisma access in the module
├─ pricing.types.ts            module DTOs (PricePreviewInput; re-exports)
├─ build-pricing-table.ts      DB rows -> PricingTable (Prisma-coupled by design)
├─ engine/                     PURE shared core: zero imports of prisma/express/ApiError
│  ├─ types.ts                 contract types + pricing-table schema + Apex rule schemas (zod)
│  ├─ money.ts                 addMoney / scaleMoney / zeroMoney / negateMoney (Elevate port)
│  ├─ compute-price.ts         computePrice -- the faithful engine port + one inserted rules pass
│  └─ evaluate-rules.ts        evaluateRules / isTriggered -- the Apex conditional-rules evaluator
└─ modes/
   ├─ handler.types.ts         PricingModeHandler interface, PricingModeContext, PricePreview
   ├─ registry.ts              Record<PricingMode, PricingModeHandler> -- the ONLY mode dispatch
   ├─ priced.handler.ts        PRICED
   ├─ from.handler.ts          FROM
   └─ quote.handler.ts         QUOTE
```

`engine/` is the cross-brand shared core (see the shared-components section): it is pure
`(data, configuration) -> DisplayedPrice` with no Prisma, Express, or `ApiError` imports, so a
future Raleigh brand lifts the folder unchanged. `modes/` and the builders are Apex-server-shaped
(they import Prisma enums and `ApiError`) but contain no per-service logic.

## 4. Engine core -- full listings

### 4.1 `src/modules/pricing/engine/types.ts`

The contract types (`Money`, `LineItem`, `DisplayedPrice`, `Configuration`) are redeclared here
rather than imported from the Elevate client package -- the server is standalone -- but they mirror
`Client/src/lib/booking/contract.schema.ts` field-for-field. One Apex extension on Configuration:
optional `description` (the QUOTE project text, persisted as `BookingConfiguration.description`).

```ts
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

const ConfigValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
]);

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
  value: z.number(), // percent points for "percent"; integer cents for "flat"
});

// ── Apex extension: conditional rules (ServicePricingRule.trigger / .effect) ───

export const MinSelectedTriggerSchema = z.object({
  kind: z.literal("min_selected"),
  group: z.string(),                    // modifier id (== ServiceConfigGroup.key)
  count: z.number().int().positive(),   // fires when selected count >= count
});

export const OptionSelectedTriggerSchema = z.object({
  kind: z.literal("option_selected"),
  group: z.string(),                    // modifier id (== ServiceConfigGroup.key)
  option: z.string(),                   // option id (== ServiceConfigOption.key)
});

export const RuleTriggerSchema = z.discriminatedUnion("kind", [
  MinSelectedTriggerSchema,
  OptionSelectedTriggerSchema,
]);
export type RuleTrigger = z.infer<typeof RuleTriggerSchema>;

export const RuleEffectSchema = z.object({
  kind: z.enum(["fee", "discount"]),
  calc: z.enum(["flat", "percent"]),
  value: z.number(), // percent points for "percent"; integer cents for "flat"
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
 * One service's pricing entry. `rules` is the Apex extension (Elevate tables omit it).
 * `mode` and `from_price` are SEED-ONLY fields (02-database.md decision #10): seed step 4
 * reads them to set Service.pricingMode / Service.fromPrice; the engine itself never
 * consults them (mode dispatch happens on the Service row, the FROM band is display-only).
 * They live in this schema so PricingTableSchema.parse validates the whole file in one pass.
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
```

Because `rules` defaults to `[]`, an unmodified Elevate `pricing.v1.json` parses and prices
identically through this schema -- the extension is strictly additive.

### 4.2 `src/modules/pricing/engine/money.ts`

Port of `Client/src/lib/money.ts` minus `formatMoney` (display formatting is a client concern; the
server never renders dollars).

```ts
import type { Money } from "./types";

export function zeroMoney(currency: string): Money {
  return { amount: 0, currency };
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
  return { amount: a.amount + b.amount, currency: a.currency };
}

export function scaleMoney(m: Money, factor: number): Money {
  return { amount: Math.round(m.amount * factor), currency: m.currency };
}

export function negateMoney(m: Money): Money {
  return { amount: -m.amount, currency: m.currency };
}
```

The `addMoney` currency guard throws a plain `Error` (not `ApiError`) -- the engine is pure and
shared; in practice the branch is unreachable because Apex tables are single-currency (`USD`).

### 4.3 `src/modules/pricing/engine/compute-price.ts` -- the port

```ts
import type {
  DisplayedPrice,
  EngineConfiguration,
  LineItem,
  Money,
  PricingTable,
} from "./types";
import { addMoney, negateMoney, scaleMoney, zeroMoney } from "./money";
import { evaluateRules } from "./evaluate-rules";

/**
 * Pure, deterministic pricing: (pricing table, configuration) -> DisplayedPrice.
 * Faithful port of Elevate Client/src/lib/pricing/engine.ts with exactly ONE
 * inserted pass (conditional rules) between the modifier loop and the fee loop.
 * Integer minor-unit math throughout. With rules: [] the output is
 * byte-identical to the Elevate client engine.
 */
export function computePrice(
  table: PricingTable,
  config: EngineConfiguration,
): DisplayedPrice {
  const currency = table.currency;
  const sp = table.services[config.service_id];

  if (!sp) {
    return {
      total: zeroMoney(currency),
      subtotal: zeroMoney(currency),
      line_items: [],
      pricing_version: table.version,
      is_estimate: true,
    };
  }

  // Step 1 -- base scaled by quantity (unchanged from Elevate).
  const lines: LineItem[] = [];
  let subtotal: Money = scaleMoney(sp.base_price, config.quantity);
  lines.push({ label: "Base", amount: subtotal, kind: "base" });

  // Step 2 -- modifiers (unchanged from Elevate).
  for (const m of sp.modifiers) {
    const sel = config.selections[m.id];
    if (sel == null || sel === false) continue;
    const ids = Array.isArray(sel) ? sel : [sel];
    for (const raw of ids) {
      const id = String(raw);
      const opt = m.options?.find((o) => o.id === id);
      const delta = opt?.delta ?? m.delta;
      if (!delta) continue;
      const amt =
        m.applies === "per_unit" ? scaleMoney(delta, config.quantity) : delta;
      subtotal = addMoney(subtotal, amt);
      lines.push({
        label: opt?.label ?? m.label,
        amount: amt,
        kind: m.options ? "option" : "modifier",
      });
    }
  }

  // Step 3 -- APEX EXTENSION: conditional rules. Percent effects compute
  // against the modifier-final subtotal (the same frozen value the fee loop
  // uses below); rule amounts accumulate into total only. `subtotal` is never
  // mutated past this point.
  let total = subtotal;
  for (const ruleLine of evaluateRules(sp.rules, config.selections, subtotal, currency)) {
    total = addMoney(total, ruleLine.amount);
    lines.push(ruleLine);
  }

  // Step 4 -- fees (unchanged from Elevate; percent computes against the
  // modifier-final `subtotal`, identical expression and rounding).
  for (const f of sp.fees) {
    const base: Money =
      f.calc === "percent"
        ? { amount: Math.round((subtotal.amount * f.value) / 100), currency }
        : { amount: f.value, currency };
    const amt = f.kind === "discount" ? negateMoney(base) : base;
    total = addMoney(total, amt);
    lines.push({ label: f.label, amount: amt, kind: f.kind });
  }

  return {
    total,
    subtotal,
    line_items: lines,
    pricing_version: table.version,
    is_estimate: true,
  };
}
```

Port-fidelity checklist (each row verified against the Elevate source):

| Elevate engine behavior | Ported | Note |
|---|---|---|
| Base scaled by quantity via `scaleMoney` | yes | quantity is an int, so `Math.round` inside `scaleMoney` never bites |
| Skip modifier when selection is `null`/`undefined`/`false` | yes | untouched groups and toggled-off toggles price as absent |
| `String(raw)` option lookup | yes | numeric selections (`"bedrooms": 3`) match option key `"3"` |
| Delta fallback `opt?.delta ?? m.delta` | yes | maps to `ServiceConfigGroup.priceDelta` for optionless groups |
| `if (!delta) continue` truthiness on a Money OBJECT | yes | `{ amount: 0 }` is truthy, so a selected zero-delta option EMITS a $0.00 line item (see example (a)). This is why the engine keeps Money objects instead of bare ints -- bare ints would make `!delta` skip zero deltas and silently change line-item output. |
| `per_unit` scaling by quantity | yes | no MVP service uses it; kept for contract parity and future brands |
| Percent fees: `Math.round(subtotal.amount * value / 100)` against the modifier-final subtotal | yes | rules reuse the identical expression |
| Unknown `service_id` returns a zero-price result | yes | unreachable in Apex (the service row is loaded first) but kept for port fidelity and shared-core reuse |
| Base line label | changed: `"Base"` (Elevate hardcodes `"Base (Sample)"`) | cosmetic only -- sample labeling moves into the seed file `note` and SAMPLE-suffixed option/rule labels; math unchanged |
| `is_estimate` always `true` | yes | foundation-pinned for the demo (all Apex prices are estimates until a coordinator confirms) |

The engine is deliberately **permissive**: selection keys that match no modifier are ignored,
unknown option ids fall back to the group delta or are skipped. Strictness (unknown key/option
rejection, required groups, MULTISELECT bounds) lives in the selection validator that runs BEFORE
any engine call in both the preview and booking paths -- see 04-configuration-engine.md and
05-api-and-validation.md. This keeps the port faithful and puts input policing where Elevate puts it.

### 4.4 `src/modules/pricing/engine/evaluate-rules.ts` -- the Apex extension

```ts
import type { LineItem, Money, PricingRule, RuleTrigger, Selections } from "./types";
import { negateMoney } from "./money";

/** Normalize a selection value EXACTLY the way the modifier loop does. */
function selectedKeys(sel: Selections[string] | undefined): string[] {
  if (sel == null || sel === false) return [];
  const ids = Array.isArray(sel) ? sel : [sel];
  return ids.map((raw) => String(raw));
}

type TriggerOf<K extends RuleTrigger["kind"]> = Extract<RuleTrigger, { kind: K }>;

/**
 * Trigger evaluators, keyed by trigger kind. A mapped Record over the
 * discriminated union: adding a trigger kind = one zod variant in
 * RuleTriggerSchema + one entry here -- the compiler rejects a missing entry.
 * No switch statements.
 */
const triggerEvaluators: {
  [K in RuleTrigger["kind"]]: (trigger: TriggerOf<K>, selections: Selections) => boolean;
} = {
  min_selected: (t, s) => selectedKeys(s[t.group]).length >= t.count,
  option_selected: (t, s) => selectedKeys(s[t.group]).includes(t.option),
};

export function isTriggered(trigger: RuleTrigger, selections: Selections): boolean {
  const evaluate = triggerEvaluators[trigger.kind] as (
    t: RuleTrigger,
    s: Selections,
  ) => boolean;
  return evaluate(trigger, selections);
}

/**
 * Evaluate conditional rules against the modifier-final subtotal. Returns one
 * signed LineItem (kind "fee" | "discount") per TRIGGERED rule, ordered by
 * sortOrder asc then key asc (deterministic tie-break). Percent effects use
 * the identical rounding expression as the Elevate fee loop. Amounts are NOT
 * accumulated here -- computePrice owns the running total.
 */
export function evaluateRules(
  rules: PricingRule[],
  selections: Selections,
  subtotal: Money,
  currency: string,
): LineItem[] {
  const ordered = [...rules].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key),
  );

  const lines: LineItem[] = [];
  for (const rule of ordered) {
    if (!isTriggered(rule.trigger, selections)) continue;
    const base: Money =
      rule.effect.calc === "percent"
        ? { amount: Math.round((subtotal.amount * rule.effect.value) / 100), currency }
        : { amount: rule.effect.value, currency };
    const amt = rule.effect.kind === "discount" ? negateMoney(base) : base;
    lines.push({ label: rule.label, amount: amt, kind: rule.effect.kind });
  }
  return lines;
}
```

Trigger semantics (pinned):

| Trigger | Fires when | Notes |
|---|---|---|
| `min_selected { group, count }` | `selectedKeys(selections[group]).length >= count` | Count of selected option keys after the SAME normalization the modifier loop uses (`null`/`false` -> 0, scalar -> 1, array -> length). `>=` satisfies the acceptance criterion "discount at exactly 3 devices": 2 selected -> no fire, 3 selected -> fire. |
| `option_selected { group, option }` | normalized selection array for `group` contains `option` | Powers frequency percent discounts (cleaning, pool). Works for SELECT and MULTISELECT alike. |

An unknown `trigger.group` evaluates to `[]` -> the rule never fires and nothing throws. Seed-time
validation (02-database.md seeding notes, 05-api-and-validation.md) rejects rules whose `trigger.group`
or `trigger.option` do not resolve against the service's groups/options, so this is a
defense-in-depth posture, not a data contract.

## 5. The PricingMode handler registry -- exactly 3 handlers

`PricingMode` is a Prisma enum (`PRICED | FROM | QUOTE`, re-exported via `src/enums`). The registry
below is the ONLY place in the codebase that dispatches on it. There is no `switch (pricingMode)`
anywhere -- not in controllers, not in the booking pipeline, not in serializers.

### 5.1 `src/modules/pricing/modes/handler.types.ts`

```ts
import type { PricingMode } from "../../../enums";
import type {
  DisplayedPrice,
  EngineConfiguration,
  Money,
  PricingTable,
} from "../engine/types";

/** The Service fields handlers need (subset of the Prisma Service row). */
export interface PricingServiceMeta {
  id: string;
  slug: string;
  pricingRef: string;
  pricingMode: PricingMode;
  fromPrice: number | null; // integer cents; display band only, NEVER a math input
  currency: string;
}

export interface PricingModeContext {
  service: PricingServiceMeta;
  table: PricingTable;               // single-entry table built from DB rows
  configuration: EngineConfiguration;
}

/**
 * The Step-3 preview payload -- also the `data` of
 * POST /api/v1/services/:idOrSlug/config/price (see 05-api-and-validation.md).
 */
export interface PricePreview {
  mode: PricingMode;
  displayed_price: DisplayedPrice | null; // null iff mode === QUOTE
  from_price: Money | null;               // non-null iff mode === FROM (the "From $X" band)
  is_from_band: boolean;                   // true iff mode === FROM (UI framing flag)
  requires_description: boolean;           // true iff mode === QUOTE
  requires_pro_confirmation: boolean;      // true for FROM and QUOTE ("final pricing
                                           // confirmed by your pro" -- PRD framing)
}

export interface PricingModeHandler {
  readonly mode: PricingMode;
  /** Step-3 live preview. Never throws for a missing description (user may still be typing). */
  preview(ctx: PricingModeContext): PricePreview;
  /**
   * Authoritative recompute inside POST /bookings. Returns the DisplayedPrice
   * the booking snapshots -- null for QUOTE (which instead demands
   * configuration.description and throws 422 without it).
   */
  recompute(ctx: PricingModeContext): DisplayedPrice | null;
}
```

Design decisions:

| Decision | Choice | Why |
|---|---|---|
| One method or two on the handler | Two: `preview` and `recompute` | Preview must be forgiving (mid-typing, partial selections after the validator's required-group check is deferred to submit); recompute must be strict (QUOTE demands description). Folding both into one method would need a `strict` flag -- an implicit mode fork. |
| Where the QUOTE description demand lives | Inside `quoteHandler.recompute` | `pricingMode` is only known after the service row loads, so transport zod cannot conditionally require the field. The transport layer still enforces it when the client self-declares a quote payload (belt, 05-api-and-validation.md); the handler is the authoritative suspenders. |
| Handler statefulness | Stateless class singletons (Elevate controller/service convention) | Matches `bookingsController`-style arrow-property singletons; trivially testable. |

### 5.2 `src/modules/pricing/modes/priced.handler.ts`

```ts
import { PricingMode } from "../../../enums";
import { computePrice } from "../engine/compute-price";
import type { DisplayedPrice } from "../engine/types";
import type { PricePreview, PricingModeContext, PricingModeHandler } from "./handler.types";

class PricedHandler implements PricingModeHandler {
  readonly mode = PricingMode.PRICED;

  preview = (ctx: PricingModeContext): PricePreview => ({
    mode: this.mode,
    displayed_price: computePrice(ctx.table, ctx.configuration),
    from_price: null,
    is_from_band: false,
    requires_description: false,
    requires_pro_confirmation: false,
  });

  recompute = (ctx: PricingModeContext): DisplayedPrice =>
    computePrice(ctx.table, ctx.configuration);
}

export const pricedHandler = new PricedHandler();
```

### 5.3 `src/modules/pricing/modes/from.handler.ts`

```ts
import { PricingMode } from "../../../enums";
import { computePrice } from "../engine/compute-price";
import type { DisplayedPrice } from "../engine/types";
import type { PricePreview, PricingModeContext, PricingModeHandler } from "./handler.types";

class FromHandler implements PricingModeHandler {
  readonly mode = PricingMode.FROM;

  preview = (ctx: PricingModeContext): PricePreview => ({
    mode: this.mode,
    // Same engine, same math as PRICED -- the difference is FRAMING, not
    // computation. Service.fromPrice is the display band ("From $99") and is
    // never a math input (Elevate parity: fromPrice is display-only).
    displayed_price: computePrice(ctx.table, ctx.configuration),
    from_price:
      ctx.service.fromPrice != null
        ? { amount: ctx.service.fromPrice, currency: ctx.service.currency }
        : null,
    is_from_band: true,
    requires_description: false,
    requires_pro_confirmation: true,
  });

  recompute = (ctx: PricingModeContext): DisplayedPrice =>
    computePrice(ctx.table, ctx.configuration);
}

export const fromHandler = new FromHandler();
```

### 5.4 `src/modules/pricing/modes/quote.handler.ts`

```ts
import { PricingMode } from "../../../enums";
import { ApiError } from "../../../utils/api-error";
import type { PricePreview, PricingModeContext, PricingModeHandler } from "./handler.types";

const MIN_DESCRIPTION_LENGTH = 10;

class QuoteHandler implements PricingModeHandler {
  readonly mode = PricingMode.QUOTE;

  // QUOTE never runs the engine and never returns a price.
  preview = (_ctx: PricingModeContext): PricePreview => ({
    mode: this.mode,
    displayed_price: null,
    from_price: null,
    is_from_band: false,
    requires_description: true,
    requires_pro_confirmation: true,
  });

  /**
   * QUOTE bookings NEVER carry a displayed_price (BookingConfiguration.priceTotal
   * stays NULL) and DEMAND configuration.description.
   */
  recompute = (ctx: PricingModeContext): null => {
    const description = ctx.configuration.description?.trim() ?? "";
    if (description.length < MIN_DESCRIPTION_LENGTH) {
      // Detail shape pinned by 05-api-and-validation.md's catalog: { code, min_length }.
      throw ApiError.unprocessable("A project description is required for quote services", {
        code: "QUOTE_DESCRIPTION_REQUIRED",
        min_length: MIN_DESCRIPTION_LENGTH,
      });
    }
    return null;
  };
}

export const quoteHandler = new QuoteHandler();
```

### 5.5 `src/modules/pricing/modes/registry.ts`

```ts
import { PricingMode } from "../../../enums";
import type { PricingModeHandler } from "./handler.types";
import { pricedHandler } from "./priced.handler";
import { fromHandler } from "./from.handler";
import { quoteHandler } from "./quote.handler";

/**
 * The ONLY PricingMode dispatch in the codebase. Record<PricingMode, ...> is
 * exhaustiveness-checked by TypeScript: adding a value to the Prisma
 * PricingMode enum makes this file fail `npm run typecheck` until a handler
 * is registered. Zero switch statements.
 */
const handlers: Record<PricingMode, PricingModeHandler> = {
  [PricingMode.PRICED]: pricedHandler,
  [PricingMode.FROM]: fromHandler,
  [PricingMode.QUOTE]: quoteHandler,
};

export function getPricingModeHandler(mode: PricingMode): PricingModeHandler {
  return handlers[mode];
}
```

### 5.6 Adding a fourth mode (the extension proof)

Suppose product adds `MEMBERSHIP` pricing post-MVP. The complete change set:

1. `schema.prisma`: `enum PricingMode { PRICED FROM QUOTE MEMBERSHIP }` + migration.
2. `modes/membership.handler.ts`: implement `PricingModeHandler`.
3. `modes/registry.ts`: one entry. (Until this line exists, the `Record` type errors -- the
   compiler enforces registration.)

No controller, route, validator, booking-pipeline, or serializer changes -- they all consume
`PricePreview`/`DisplayedPrice | null` shapes that are already mode-agnostic. Reassigning an
EXISTING service between modes (e.g. handyman FROM -> QUOTE) is a seed data change only:
`Service.pricingMode` is a column, not code.

## 6. From database rows to engine input

The engine consumes the `PricingTable` shape; the database owns the data at runtime
(`prisma/seed-data/apex-pricing.v1.json` is the seed INPUT, parsed with `PricingTableSchema` by
`prisma/seed.ts` and written into `Service` / `ServiceConfigGroup` / `ServiceConfigOption` /
`ServicePricingRule` rows -- see 02-database.md). At request time the builder reconstitutes a
single-entry table from rows, which keeps `computePrice`'s signature IDENTICAL to the published
Elevate engine.

The id-alignment contract (Elevate-verified, unchanged): `ServiceConfigGroup.key` IS the modifier
`id`, `ServiceConfigOption.key` IS the option `id`, carried verbatim from the pricing source and
never re-slugged from labels. Resolution at price time:
`selections[group.key] -> option.key -> option delta (?? group delta)`.

### 6.1 `src/modules/pricing/build-pricing-table.ts`

```ts
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
 * depends on the call site's query shape (it is also used by seed validation
 * and tests with raw arrays).
 */
export function buildPricingTable(service: ServiceWithPricingRows): PricingTable {
  const money = (amount: number) => ({ amount, currency: service.currency });

  const modifiers: Modifier[] = service.configGroups
    .filter(
      (g) =>
        g.status === ConfigStatus.ACTIVE && g.inputType !== ConfigInputType.TEXTAREA,
    )
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
      // loudly here (500 + log) instead of pricing wrong silently.
      trigger: RuleTriggerSchema.parse(r.trigger),
      effect: RuleEffectSchema.parse(r.effect),
      sortOrder: r.sortOrder,
    }));

  const entry: ServicePricing = {
    base_price: money(service.basePrice),
    modifiers,
    fees: [], // no unconditional fees in the Apex MVP seed; the slot exists for parity
    rules,
  };

  return {
    version: PRICING_VERSION,
    currency: service.currency,
    services: { [service.pricingRef]: entry },
  };
}
```

`PRICING_VERSION = "apex-pricing.v1"` lives in `src/constants` and is stamped into every
`DisplayedPrice.pricing_version` and every `BookingConfiguration.pricingVersion` snapshot.

### 6.2 `src/modules/pricing/pricing.repository.ts`

```ts
import { prisma } from "../../db/client";
import { ConfigStatus } from "../../enums";

class PricingRepository {
  /** Service by id OR slug with everything pricing needs, in one query. */
  findServiceForPricing(idOrSlug: string) {
    return prisma.service.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: {
        configGroups: {
          where: { status: ConfigStatus.ACTIVE },
          orderBy: { sortOrder: "asc" },
          include: {
            options: {
              where: { status: ConfigStatus.ACTIVE },
              orderBy: { sortOrder: "asc" },
            },
          },
        },
        pricingRules: {
          where: { status: ConfigStatus.ACTIVE },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
  }
}

export const pricingRepository = new PricingRepository();
```

(Relation field names `Service.configGroups` and `Service.pricingRules` are pinned here; the schema
in 02-database.md declares them.)

### 6.3 `src/modules/pricing/pricing.types.ts`

```ts
import type { Selections } from "./engine/types";

/** Input to preview/recompute; mirrors the POST .../config/price body (deviation 4). */
export interface PricePreviewInput {
  selections?: Selections;
  quantity?: number;
  /**
   * QUOTE project text. Supplied by the booking pipeline (from
   * configuration.description); ABSENT from the preview endpoint body, whose
   * pinned shape is { selections, quantity? }.
   */
  description?: string;
}

export type {
  PricePreview,
  PricingModeContext,
  PricingModeHandler,
  PricingServiceMeta,
} from "./modes/handler.types";
```

### 6.4 `src/modules/pricing/pricing.service.ts`

```ts
import { ServiceStatus } from "../../enums";
import { ApiError } from "../../utils/api-error";
import type { DisplayedPrice } from "./engine/types";
import { buildPricingTable } from "./build-pricing-table";
import { getPricingModeHandler } from "./modes/registry";
import type { PricePreview, PricePreviewInput, PricingModeContext } from "./pricing.types";
import { pricingRepository } from "./pricing.repository";

/**
 * Compare the server-recomputed price against the client-sent displayed_price.
 * The recompute is ALWAYS authoritative; the client value is a cross-check,
 * never an input. Mismatch -> 422, never silently accepted, never clamped.
 */
export function assertPriceIntegrity(
  recomputed: DisplayedPrice | null,
  clientPrice: DisplayedPrice | null,
): void {
  if (!clientPrice) return; // client price optional; recompute stands alone

  if (!recomputed) {
    // QUOTE services must not carry a displayed_price at all (PRD rule).
    // Code + detail shape are owned by 05-api-and-validation.md's error catalog.
    throw ApiError.unprocessable("Quote services do not carry a price", {
      code: "QUOTE_PRICE_NOT_ALLOWED",
    });
  }

  const matches =
    recomputed.total.amount === clientPrice.total.amount &&
    recomputed.total.currency === clientPrice.total.currency;

  if (!matches) {
    // Detail field names pinned by 05-api-and-validation.md (section 5.6 + catalog):
    // bare-cent totals for quick client display, full displayed_price for recovery.
    throw ApiError.unprocessable("Price mismatch", {
      code: "PRICE_MISMATCH",
      client_total: clientPrice.total.amount,
      server_total: recomputed.total.amount,
      pricing_version: recomputed.pricing_version,
      displayed_price: recomputed,
    });
  }
}

class PricingService {
  /** Step-3 live preview -- POST /services/:idOrSlug/config/price. */
  async preview(idOrSlug: string, input: PricePreviewInput): Promise<PricePreview> {
    const ctx = await this.buildContext(idOrSlug, input);
    return getPricingModeHandler(ctx.service.pricingMode).preview(ctx);
  }

  /**
   * Authoritative recompute inside POST /bookings (pipeline step "pricing",
   * see 06-pipeline-shared-roadmap.md). Returns the DisplayedPrice the booking
   * snapshots into BookingConfiguration (priceTotal / priceSubtotal /
   * lineItems / pricingVersion / isEstimate) -- null for QUOTE, which keeps
   * priceTotal NULL and thereby enforces "QUOTE omits displayed_price" at the
   * storage layer. Read-only: runs BEFORE the booking transaction.
   */
  async recomputeForBooking(
    idOrSlug: string,
    input: PricePreviewInput,
    clientPrice: DisplayedPrice | null,
  ): Promise<DisplayedPrice | null> {
    const ctx = await this.buildContext(idOrSlug, input);
    const recomputed = getPricingModeHandler(ctx.service.pricingMode).recompute(ctx);
    assertPriceIntegrity(recomputed, clientPrice);
    return recomputed;
  }

  private async buildContext(
    idOrSlug: string,
    input: PricePreviewInput,
  ): Promise<PricingModeContext> {
    const service = await pricingRepository.findServiceForPricing(idOrSlug);
    // errors.code on every operational 4xx per 05's catalog (notFound/badRequest
    // take an optional details argument -- pinned factory extension, 05 section 8).
    if (!service) {
      throw ApiError.notFound("Service not found", { code: "SERVICE_NOT_FOUND", idOrSlug });
    }
    if (service.status !== ServiceStatus.ACTIVE) {
      throw ApiError.badRequest("This service is not currently bookable", {
        code: "SERVICE_NOT_BOOKABLE",
        status: service.status,
      });
    }

    // Reference validation (unknown keys/options, required groups, MULTISELECT
    // bounds) has already run at the call site -- see 05-api-and-validation.md. The
    // engine stays permissive by design (port fidelity).
    return {
      service: {
        id: service.id,
        slug: service.slug,
        pricingRef: service.pricingRef,
        pricingMode: service.pricingMode,
        fromPrice: service.fromPrice,
        currency: service.currency,
      },
      table: buildPricingTable(service),
      configuration: {
        service_id: service.pricingRef,
        selections: input.selections ?? {},
        quantity: input.quantity ?? 1,
        description: input.description,
      },
    };
  }
}

export const pricingService = new PricingService();
```

### 6.5 `src/modules/pricing/index.ts`

```ts
// Routeless internal module (Elevate precedent: modules/notifications).
export { pricingService, assertPriceIntegrity } from "./pricing.service";
export { computePrice } from "./engine/compute-price";
export { evaluateRules } from "./engine/evaluate-rules";
export { buildPricingTable } from "./build-pricing-table";
export * from "./engine/types";
export type { PricePreview, PricePreviewInput } from "./pricing.types";
```

## 7. The plug-in table: all 11 services as data

Every PRICED and FROM service runs the SAME `computePrice` against its own rows; every QUOTE
service runs no engine at all. There is no per-service code anywhere in the server. `pricingRef`
equals `slug` for every Apex service (Elevate allows divergence; Apex keeps them 1:1 for seed
legibility -- pinned).

Amounts marked SAMPLE are seed placeholders awaiting product sign-off (owner: Apex product,
tracked in the open-questions list of this doc set); amounts marked VERIFIED come from the built
frontend data files under `client/src/data/`.

| # | slug | mode | Config groups (key: inputType [uiHint]) | Rules (key: trigger -> effect) | Pricing expressed as data |
|---|---|---|---|---|---|
| 1 | `cleaning` | PRICED | `cleaning-type`: SELECT [matrix-axis]; `bedrooms`: SELECT [matrix-axis]; `bathrooms`: SELECT [matrix-axis]; `frequency`: SELECT [frequency] | `freq-weekly-discount`: option_selected(frequency, weekly) -> discount percent 20 SAMPLE; `freq-biweekly-discount`: option_selected(frequency, biweekly) -> discount percent 15 SAMPLE; `freq-monthly-discount`: option_selected(frequency, monthly) -> discount percent 10 SAMPLE | base_price 0; type deltas 9500/14500/19500 VERIFIED; bedroom n -> n*2500 VERIFIED; bathroom n -> n*1500 VERIFIED; frequency deltas all 0 (rules do the math) |
| 2 | `lawn-care` | PRICED | `lot-size`: SELECT | none | base_price 0; small 4500 / medium 6500 / large 9000 / xlarge 13000 VERIFIED |
| 3 | `junk-removal` | PRICED | `load-size`: SELECT [load-estimator] | none | base_price 0; quarter 9900 / half 17900 / three-quarter 24900 / full 32900 SAMPLE |
| 4 | `pool` | PRICED | `pool-size`: SELECT; `frequency`: SELECT [frequency] | `freq-monthly-discount`: option_selected(frequency, monthly) -> discount percent 15 (models the frontend 0.85 multiplier) | base_price 0; small 8900 / medium 12000 / large 15900 / custom 19900 VERIFIED; frequency deltas all 0 |
| 5 | `pest-control` | PRICED | `plan`: SELECT; `pest-type`: SELECT | none | base_price 0; plan one-time 19900 / quarterly 9900 / monthly 7900 SAMPLE; pest-type deltas all 0 (pro-routing info, keys VERIFIED from pestSelectorData) |
| 6 | `smart-home` | PRICED | `devices`: MULTISELECT [device-checklist], selectMin 1 | `multi-device-discount`: min_selected(devices, 3) -> discount percent 15 (PRD acceptance criterion: fires at EXACTLY >= 3) | base_price 0; per-device deltas 4900-14900 SAMPLE (listed below) |
| 7 | `power-washing` | FROM | `surfaces`: MULTISELECT, selectMin 1 | none | base_price 0; surface deltas SAMPLE (below); `fromPrice` 9900 = display band only |
| 8 | `handyman` | FROM | `job-type`: SELECT | none | base_price 0; job deltas SAMPLE (below); `fromPrice` 6500 = display band only |
| 9 | `painting` | QUOTE | `description`: TEXTAREA (required) | none | no engine run; empty pricing entry; `BookingConfiguration.priceTotal` NULL |
| 10 | `home-security` | QUOTE | `description`: TEXTAREA (required) | none | same as painting; `Service.claimsBlock` carries NC alarm-license copy |
| 11 | `tree-stump` | QUOTE | `description`: TEXTAREA (required) | none | same as painting |

TEXTAREA groups exist so `GET /services/:idOrSlug/config` renders the quote textarea with the same
generic configurator the other services use (04-configuration-engine.md); their submitted value
travels as `configuration.description`, never inside `selections`, and `buildPricingTable`
excludes them from modifiers -- they can never price.

### 7.1 Option-level seed detail (keys pinned; cents)

- `cleaning` / `cleaning-type`: `standard` "Standard" 9500; `deep` "Deep Clean" 14500;
  `move-in-out` "Move In/Out" 19500. VERIFIED (`configuratorData.ts`: $95/$145/$195).
- `cleaning` / `bedrooms`: `"1"`..`"5"`, labels "1 bedroom".."5 bedrooms", deltas
  2500/5000/7500/10000/12500 (n*2500). VERIFIED (+$25 per bedroom).
- `cleaning` / `bathrooms`: `"1"`..`"4"`, labels "1 bathroom".."4 bathrooms", deltas
  1500/3000/4500/6000 (n*1500). VERIFIED (+$15 per bathroom).
- `cleaning` / `frequency`: `one-time` "One-time" 0; `weekly` "Weekly" 0; `biweekly` "Bi-weekly" 0;
  `monthly` "Monthly" 0. Discounts come from the three rules; `one-time` has no rule (0%).
- `lawn-care` / `lot-size`: `small` "Small yard" (sublabel "Up to 1/4 acre") 4500; `medium`
  "Medium yard" ("1/4 - 1/2 acre") 6500; `large` "Large yard" ("1/2 - 1 acre") 9000; `xlarge`
  "Extra large yard" ("1+ acre") 13000. Keys VERIFIED identical to `sizeSelectorData.ts` ids.
- `junk-removal` / `load-size`: `quarter` "Quarter truck" 9900; `half` "Half truck" 17900;
  `three-quarter` "Three-quarter truck" 24900; `full` "Full truck" 32900. SAMPLE.
- `pool` / `pool-size`: `small` 8900; `medium` 12000; `large` 15900; `custom` 19900. Keys and
  amounts VERIFIED from `poolData.ts`. / `frequency`: `weekly` 0; `biweekly` 0; `monthly` 0.
- `pest-control` / `plan`: `one-time` "One-time treatment" 19900; `quarterly` "Quarterly plan (per
  visit)" 9900; `monthly` "Monthly plan (per visit)" 7900. SAMPLE. / `pest-type`: `general`,
  `indoor`, `outdoor`, `rodent` (deltas 0; keys VERIFIED from `pestSelectorData.ts`).
- `smart-home` / `devices`: `smart-plug-hub` "Smart plug / hub" 4900; `video-doorbell`
  "Video doorbell" 9900; `security-camera` "Security camera" 11900; `smart-thermostat`
  "Smart thermostat" 12900; `smart-lock` "Smart lock" 14900. SAMPLE.
- `power-washing` / `surfaces`: `fence` "Fence" 9900; `driveway-sidewalk` "Driveway / sidewalk"
  12900; `deck-patio` "Deck / patio" 14900; `house-siding` "House siding" 19900. SAMPLE.
- `handyman` / `job-type`: `small-repair` "Small repair" 6500; `furniture-assembly`
  "Furniture assembly" 7900; `fixture-install` "Fixture install" 8900; `tv-mounting` "TV mounting"
  9900. SAMPLE.

### 7.2 `prisma/seed-data/apex-pricing.v1.json` excerpt (four representative entries)

```json
{
  "version": "apex-pricing.v1",
  "currency": "USD",
  "note": "SAMPLE PLACEHOLDER PRICES for junk/pest/smart-home/power-washing/handyman -- not real quotes. Cleaning, lawn, pool amounts verified against client/src/data.",
  "services": {
    "cleaning": {
      "mode": "PRICED",
      "base_price": { "amount": 0, "currency": "USD" },
      "modifiers": [
        {
          "id": "cleaning-type",
          "label": "Cleaning Type",
          "type": "select",
          "applies": "flat",
          "options": [
            { "id": "standard", "label": "Standard", "delta": { "amount": 9500, "currency": "USD" } },
            { "id": "deep", "label": "Deep Clean", "delta": { "amount": 14500, "currency": "USD" } },
            { "id": "move-in-out", "label": "Move In/Out", "delta": { "amount": 19500, "currency": "USD" } }
          ]
        },
        {
          "id": "bedrooms",
          "label": "Bedrooms",
          "type": "select",
          "applies": "flat",
          "options": [
            { "id": "1", "label": "1 bedroom", "delta": { "amount": 2500, "currency": "USD" } },
            { "id": "2", "label": "2 bedrooms", "delta": { "amount": 5000, "currency": "USD" } },
            { "id": "3", "label": "3 bedrooms", "delta": { "amount": 7500, "currency": "USD" } },
            { "id": "4", "label": "4 bedrooms", "delta": { "amount": 10000, "currency": "USD" } },
            { "id": "5", "label": "5 bedrooms", "delta": { "amount": 12500, "currency": "USD" } }
          ]
        },
        {
          "id": "bathrooms",
          "label": "Bathrooms",
          "type": "select",
          "applies": "flat",
          "options": [
            { "id": "1", "label": "1 bathroom", "delta": { "amount": 1500, "currency": "USD" } },
            { "id": "2", "label": "2 bathrooms", "delta": { "amount": 3000, "currency": "USD" } },
            { "id": "3", "label": "3 bathrooms", "delta": { "amount": 4500, "currency": "USD" } },
            { "id": "4", "label": "4 bathrooms", "delta": { "amount": 6000, "currency": "USD" } }
          ]
        },
        {
          "id": "frequency",
          "label": "Frequency",
          "type": "select",
          "applies": "flat",
          "options": [
            { "id": "one-time", "label": "One-time", "delta": { "amount": 0, "currency": "USD" } },
            { "id": "weekly", "label": "Weekly", "delta": { "amount": 0, "currency": "USD" } },
            { "id": "biweekly", "label": "Bi-weekly", "delta": { "amount": 0, "currency": "USD" } },
            { "id": "monthly", "label": "Monthly", "delta": { "amount": 0, "currency": "USD" } }
          ]
        }
      ],
      "fees": [],
      "rules": [
        {
          "key": "freq-weekly-discount",
          "label": "Weekly discount (Sample)",
          "trigger": { "kind": "option_selected", "group": "frequency", "option": "weekly" },
          "effect": { "kind": "discount", "calc": "percent", "value": 20 },
          "sortOrder": 1
        },
        {
          "key": "freq-biweekly-discount",
          "label": "Bi-weekly discount (Sample)",
          "trigger": { "kind": "option_selected", "group": "frequency", "option": "biweekly" },
          "effect": { "kind": "discount", "calc": "percent", "value": 15 },
          "sortOrder": 2
        },
        {
          "key": "freq-monthly-discount",
          "label": "Monthly discount (Sample)",
          "trigger": { "kind": "option_selected", "group": "frequency", "option": "monthly" },
          "effect": { "kind": "discount", "calc": "percent", "value": 10 },
          "sortOrder": 3
        }
      ]
    },
    "smart-home": {
      "mode": "PRICED",
      "base_price": { "amount": 0, "currency": "USD" },
      "modifiers": [
        {
          "id": "devices",
          "label": "Devices to install",
          "type": "multiselect",
          "applies": "flat",
          "options": [
            { "id": "smart-plug-hub", "label": "Smart plug / hub", "delta": { "amount": 4900, "currency": "USD" } },
            { "id": "video-doorbell", "label": "Video doorbell", "delta": { "amount": 9900, "currency": "USD" } },
            { "id": "security-camera", "label": "Security camera", "delta": { "amount": 11900, "currency": "USD" } },
            { "id": "smart-thermostat", "label": "Smart thermostat", "delta": { "amount": 12900, "currency": "USD" } },
            { "id": "smart-lock", "label": "Smart lock", "delta": { "amount": 14900, "currency": "USD" } }
          ]
        }
      ],
      "fees": [],
      "rules": [
        {
          "key": "multi-device-discount",
          "label": "Multi-device discount (15%)",
          "trigger": { "kind": "min_selected", "group": "devices", "count": 3 },
          "effect": { "kind": "discount", "calc": "percent", "value": 15 },
          "sortOrder": 1
        }
      ]
    },
    "power-washing": {
      "mode": "FROM",
      "from_price": { "amount": 9900, "currency": "USD" },
      "base_price": { "amount": 0, "currency": "USD" },
      "modifiers": [
        {
          "id": "surfaces",
          "label": "Surfaces",
          "type": "multiselect",
          "applies": "flat",
          "options": [
            { "id": "fence", "label": "Fence", "delta": { "amount": 9900, "currency": "USD" } },
            { "id": "driveway-sidewalk", "label": "Driveway / sidewalk", "delta": { "amount": 12900, "currency": "USD" } },
            { "id": "deck-patio", "label": "Deck / patio", "delta": { "amount": 14900, "currency": "USD" } },
            { "id": "house-siding", "label": "House siding", "delta": { "amount": 19900, "currency": "USD" } }
          ]
        }
      ],
      "fees": [],
      "rules": []
    },
    "painting": {
      "mode": "QUOTE",
      "base_price": { "amount": 0, "currency": "USD" },
      "modifiers": [],
      "fees": [],
      "rules": []
    }
  }
}
```

QUOTE services keep an (empty) pricing entry so `pricingRef` always resolves and the seed validator
runs one uniform pass; the engine never reads it because `quoteHandler` never calls `computePrice`.

### 7.3 Decision: cleaning base representation

| Candidate | Verdict |
|---|---|
| `base_price 0` + type deltas 9500/14500/19500 (full prices) | **CHOSEN.** Symmetric with lawn/junk/pool/pest ("one SELECT carries the price"); every matrix axis is a visible line item; no privileged default cleaning type; the seed reads exactly like the marketing sheet ($95/$145/$195). |
| `base_price 9500` + type deltas 0/5000/10000 | Rejected: silently privileges Standard as "the" base, makes the Deep/Move line items read as surcharges instead of prices, and makes reassigning the cheapest type a two-place edit. Same totals either way -- this is a legibility choice. |

### 7.4 Adding service #12 (the no-code proof)

1. Add a catalog entry to `prisma/seed-data/apex-catalog.json` (slug, name, category,
   `pricingMode`, `pricingRef`, `fromPrice?`, badges, claimsBlock?).
2. Add a pricing entry to `prisma/seed-data/apex-pricing.v1.json` (base_price, modifiers, rules).
3. `npm run prisma:seed`.

Zero TypeScript changes. The configurator payload, price preview, booking pipeline, recompute, and
quote routing all follow from `pricingMode` + rows.

## 8. Worked examples (exact cent arithmetic)

### 8.1 (a) Cleaning: 3 bed / 2 bath / Deep Clean / bi-weekly

Input: `POST /services/cleaning/config/price` with
`{ "selections": { "cleaning-type": "deep", "bedrooms": "3", "bathrooms": "2", "frequency": "biweekly" }, "quantity": 1 }`.

| Step | Line item | kind | amount (cents) | running subtotal | running total |
|---|---|---|---|---|---|
| 1 base | Base | base | 0 (0 * 1) | 0 | -- |
| 2 modifier | Deep Clean | option | +14500 | 14500 | -- |
| 2 modifier | 3 bedrooms | option | +7500 | 22000 | -- |
| 2 modifier | 2 bathrooms | option | +3000 | 25000 | -- |
| 2 modifier | Bi-weekly | option | +0 | 25000 | -- |
| (freeze) | -- | -- | -- | **25000** | 25000 |
| 3 rule | Bi-weekly discount (Sample) | discount | -3750 = -Math.round(25000 * 15 / 100) | 25000 | 21250 |
| 4 fees | (none) | -- | -- | 25000 | **21250** |

The `Bi-weekly +0` line is the port-fidelity artifact from section 4.3: the option's delta is the
truthy object `{ amount: 0 }`, so it emits a $0.00 line item exactly as the Elevate client engine
does. Dollar check: $145 + 3 x $25 + 2 x $15 = $250.00; minus 15% = **$212.50**.

Resulting `DisplayedPrice`:

```json
{
  "total": { "amount": 21250, "currency": "USD" },
  "subtotal": { "amount": 25000, "currency": "USD" },
  "line_items": [
    { "label": "Base", "amount": { "amount": 0, "currency": "USD" }, "kind": "base" },
    { "label": "Deep Clean", "amount": { "amount": 14500, "currency": "USD" }, "kind": "option" },
    { "label": "3 bedrooms", "amount": { "amount": 7500, "currency": "USD" }, "kind": "option" },
    { "label": "2 bathrooms", "amount": { "amount": 3000, "currency": "USD" }, "kind": "option" },
    { "label": "Bi-weekly", "amount": { "amount": 0, "currency": "USD" }, "kind": "option" },
    { "label": "Bi-weekly discount (Sample)", "amount": { "amount": -3750, "currency": "USD" }, "kind": "discount" }
  ],
  "pricing_version": "apex-pricing.v1",
  "is_estimate": true
}
```

### 8.2 (b) Smart home: 2 devices vs exactly 3 devices (the acceptance-criterion edge)

**Two devices** -- `{ "selections": { "devices": ["video-doorbell", "smart-thermostat"] } }`:

| Line item | kind | amount | subtotal |
|---|---|---|---|
| Base | base | 0 | 0 |
| Video doorbell | option | +9900 | 9900 |
| Smart thermostat | option | +12900 | 22800 |

Rule check: `min_selected(devices, 3)` -> `selectedKeys(["video-doorbell","smart-thermostat"]).length = 2`;
`2 >= 3` is **false** -> no discount line. Total = **22800** ($228.00). No discount at 2 devices.

**Three devices** -- add `"smart-lock"`:

| Line item | kind | amount | subtotal |
|---|---|---|---|
| Base | base | 0 | 0 |
| Video doorbell | option | +9900 | 9900 |
| Smart thermostat | option | +12900 | 22800 |
| Smart lock | option | +14900 | 37700 |

Rule check: count = 3; `3 >= 3` is **true** ->
`Math.round(37700 * 15 / 100) = Math.round(5655) = 5655` ->
line item `{ "label": "Multi-device discount (15%)", "amount": { "amount": -5655, "currency": "USD" }, "kind": "discount" }`.
Total = 37700 - 5655 = **32045** ($320.45).

This is the PRD acceptance criterion made mechanical: the threshold lives in
`trigger.count = 3` in a `ServicePricingRule` row -- not in code, and never client-asserted (a
client cannot inject the discount; only the recompute can produce it).

### 8.3 (c) FROM preview: power washing, driveway + deck

`POST /api/v1/services/power-washing/config/price` with
`{ "selections": { "surfaces": ["driveway-sidewalk", "deck-patio"] } }`.
Engine: base 0, +12900, +14900 -> subtotal = total = 27800. Full envelope response:

```json
{
  "success": true,
  "message": "Price preview computed",
  "data": {
    "mode": "FROM",
    "displayed_price": {
      "total": { "amount": 27800, "currency": "USD" },
      "subtotal": { "amount": 27800, "currency": "USD" },
      "line_items": [
        { "label": "Base", "amount": { "amount": 0, "currency": "USD" }, "kind": "base" },
        { "label": "Driveway / sidewalk", "amount": { "amount": 12900, "currency": "USD" }, "kind": "option" },
        { "label": "Deck / patio", "amount": { "amount": 14900, "currency": "USD" }, "kind": "option" }
      ],
      "pricing_version": "apex-pricing.v1",
      "is_estimate": true
    },
    "from_price": { "amount": 9900, "currency": "USD" },
    "is_from_band": true,
    "requires_description": false,
    "requires_pro_confirmation": true
  }
}
```

The UI renders "From $278.00 -- final pricing confirmed by your pro" (or band-only "From $99",
a UI choice); the math is identical to PRICED -- only the framing flags differ.

### 8.4 (d) QUOTE response: painting

`POST /api/v1/services/painting/config/price` (any body):

```json
{
  "success": true,
  "message": "Price preview computed",
  "data": {
    "mode": "QUOTE",
    "displayed_price": null,
    "from_price": null,
    "is_from_band": false,
    "requires_description": true,
    "requires_pro_confirmation": true
  }
}
```

At booking time, `quoteHandler.recompute` demands `configuration.description`; submitting a
painting booking with a 4-character description yields:

```json
{
  "success": false,
  "message": "A project description is required for quote services",
  "errors": [
    {
      "path": "configuration.description",
      "message": "Describe the project in at least 10 characters",
      "code": "QUOTE_DESCRIPTION_REQUIRED"
    }
  ]
}
```

A successful QUOTE booking stores `BookingConfiguration.priceTotal = NULL`, sets
`Booking.quoteRequest = true` (derived from `service.pricingMode`, never from the client), and the
pipeline creates the linked `QuoteRequest` record (06-pipeline-shared-roadmap.md).

## 9. The recompute-integrity contract

Pinned policy, enforced by `assertPriceIntegrity` (section 6.4) inside
`pricingService.recomputeForBooking`, which `POST /bookings` calls before its write transaction:

1. **The server always recomputes.** The booking snapshots ONLY the recomputed
   `DisplayedPrice` into `BookingConfiguration` (`priceTotal`, `priceSubtotal`, `lineItems`,
   `pricingVersion`, `isEstimate`). The client-sent `displayed_price` is never stored.
2. **Comparison is total-only, exact, zero tolerance**: `recomputed.total.amount ===
   client.total.amount && currency ===`. Line items and labels are NOT compared -- they are
   presentation, and comparing them would turn copy edits into booking failures.
3. **Client price is optional.** A PRICED/FROM booking submitted WITHOUT `displayed_price` succeeds
   with the recomputed price -- the client value is a cross-check, not an input.
4. **Mismatch -> 422, never silently accept, never clamp.** The response carries the recomputed
   price in details so the client can re-render and resubmit:

```json
{
  "success": false,
  "message": "Price mismatch",
  "errors": {
    "code": "PRICE_MISMATCH",
    "client_total": 21200,
    "server_total": 21250,
    "pricing_version": "apex-pricing.v1",
    "displayed_price": {
      "total": { "amount": 21250, "currency": "USD" },
      "subtotal": { "amount": 25000, "currency": "USD" },
      "line_items": [ "...as in example (a)..." ],
      "pricing_version": "apex-pricing.v1",
      "is_estimate": true
    }
  }
}
```

   (Detail field names owned by 05-api-and-validation.md's error catalog: bare-cent
   `client_total`/`server_total` for quick display, full `displayed_price` for re-render.)

5. **QUOTE + displayed_price -> 422 `QUOTE_PRICE_NOT_ALLOWED`** (the mirror rule: quote bookings
   never carry a price, so a client-sent price is itself the integrity violation).

**This recompute is the ONLY integrity guard.** There are deliberately NO PostgreSQL CHECK
constraints on `priceDelta`, `basePrice`, or rule `value` columns (Elevate parity: its schema has
none either). Bad seed data is caught by `PricingTableSchema.parse` at seed time, by
`RuleTriggerSchema/RuleEffectSchema.parse` on every table build, and by the golden test suite --
not by the database. The golden suite pins the acceptance criteria: all 240 cleaning matrix cells
(5 beds x 4 baths x 3 types x 4 frequencies) asserted to exact cents, the smart-home 2-vs-3 edge,
and an Elevate-fixture parity replay (section 2.1).

Common benign mismatch cause: a stale client cache across a seed reprice. `pricing_version` in the
error details lets the client detect version drift and silently re-preview instead of showing an
error state.

## 10. Deviations from Elevate touching this section

| Deviation | Justification |
|---|---|
| Server-side ported engine instead of Elevate's additive `quotePrice` (pinned deviation 2) | Matrix (cleaning), percent (frequency), and threshold (smart-home) pricing cannot be expressed as `base + sum(optionModifier)`; the server recompute is the integrity guard, so the real engine must live server-side. |
| Conditional-rules layer: `rules` array in the table schema + `ServicePricingRule` rows + one inserted engine pass (the substance of pinned deviation 2) | The published engine has NO conditional construct; "15% off at >= 3 devices" and frequency percent discounts are inexpressible as flat deltas or unconditional fees. Strictly additive: `rules: []` reproduces Elevate byte-for-byte. |
| Preview body `{ selections, quantity }` instead of `{ optionIds: string[] }` (pinned deviation 4) | Keyed selections are required for matrix/quantity semantics and match the P14-M2 Configuration contract verbatim. |
| Public, non-role-aware preview (consequence of pinned deviation 3) | No customer accounts in the Apex MVP; only ACTIVE catalog rows ever price, so Elevate's staff-visibility branch has nothing to gate. |
| Base line-item label `"Base"` instead of the hardcoded `"Base (Sample)"` | Cosmetic only; sample labeling belongs in seed data (`note`, SAMPLE-suffixed labels), not compiled code. Math and line-item structure unchanged. |

## 11. Why not the alternatives (appendix)

**Per-service strategy classes** (a `CleaningPricingStrategy`, `LawnPricingStrategy`, ... each
implementing `IPricingStrategy`). This puts prices in code: every rate change becomes a TypeScript
edit, review, build, and deploy, and the 12th service means a new class even when its pricing shape
(one SELECT) already exists five times. It also forks the math: eleven `computeTotal`
implementations drift independently, and the acceptance-critical guarantees (integer cents, one
rounding point, line-item vocabulary) have to be re-audited per class. The strategy pattern earns
its keep when behaviors genuinely differ; here all eleven services share ONE behavior
(base -> modifiers -> rules -> fees) with different DATA, and the only true behavioral split --
PRICED/FROM/QUOTE framing -- is exactly three handlers, which is what the registry holds.

**A giant switch** (`switch (service.slug)` inside a pricing function). Everything wrong with
strategy classes, plus worse coupling: the pricing module must KNOW every slug, so seed data and
code can silently disagree (a renamed slug prices as `default:` or throws at runtime), reassigning
a service between modes becomes a code change, and future brands cannot reuse the module without
editing the switch. It also concentrates merge conflicts in one hot file and makes the
compile-time exhaustiveness we get from `Record<PricingMode, PricingModeHandler>` impossible --
slugs are open-ended strings, not a closed enum.

**Price columns on service rows** (e.g. `Service.deepCleanPrice`, `Service.perBedroomPrice`,
`Service.threeDeviceDiscountPct`). This hardwires today's eleven configurators into the schema:
every new axis or option is a migration; columns are nullable noise for the ten services they do
not apply to; the beds x baths x type x frequency matrix either explodes into dozens of columns or
collapses into an opaque JSON blob with no id-alignment contract; and nothing composes -- the
smart-home threshold discount still needs special-case code to read its bespoke column. The
normalized `ServiceConfigGroup` / `ServiceConfigOption` / `ServicePricingRule` rows are exactly
Elevate's proven model plus one additive table, keep `@@unique([serviceId, key])` integrity, and
make "pricing is data" literally true: every number in section 7 is a row, and the engine that
reads them never changes.
