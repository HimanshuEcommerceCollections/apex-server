# Configuration engine: declarative service configurators

This section specifies DELIVERABLE 4: the reusable configuration entities that let every one of
the 11 Apex services describe its booking configurator (dropdowns, radio cards, multiselect
checklists, numeric steppers, the junk-removal visual load estimator, and the QUOTE description
textarea) as **seed data only** -- zero custom code per service. It restates the id-alignment
contract that binds configuration rows to pricing math, gives the full seed-data blueprint for all
11 services, pins the QUOTE description channel, defines the `GET /services/:idOrSlug/config`
response contract with full JSON examples, and draws the line between what the configuration
engine validates and what the pricing engine validates.

Companion sections in this directory: `02-database.md` owns the full Prisma schema, the seed-data
file formats, and `prisma/seed.ts`; `03-pricing-engine.md` owns the ported engine, the conditional
rules evaluator, the DB-rows-to-engine-table mapper, and the canonical per-service pricing data;
`05-api-and-validation.md` owns the full route catalog, the zod transport layer, and the
error-code catalog; `06-pipeline-shared-roadmap.md` owns where selection validation runs inside
`POST /bookings` and the cross-brand packaging of the selection validator. Pinned model, enum, and
endpoint names come from the foundation spec and are used verbatim here.

## 1. Design goal and constraints

The configurator is three Prisma tables plus one presentation column:

| Table | Role |
|---|---|
| `ServiceConfigGroup` | One configurable dimension of a service (a question the UI asks). Carries `key`, `label`, `inputType ConfigInputType`, `uiHint String?`, `applies ConfigApplies`, `isRequired`, `priceDelta Int?` (group-level fallback for optionless groups), `selectMin Int?`, `selectMax Int?`, `sortOrder`, `status`. `@@unique([serviceId, key])`. |
| `ServiceConfigOption` | One answer within a group. Carries `key`, `label`, `sublabel String?`, `priceDelta Int` (cents, >= 0 in MVP), `sortOrder`, `status`. `@@unique([groupId, key])`. |
| `ServicePricingRule` | The Apex conditional-rules extension (foundation-pinned): `key`, `label`, `trigger Json`, `effect Json`, `sortOrder`, `status`. Evaluated in the fee slot of the engine; produces `fee`/`discount` line items. |

Full column definitions live in `02-database.md`; this section is the authority on how the
rows are authored and interpreted.

Hard constraints, all inherited from the foundation spec and the verified Elevate conventions:

1. **Semantics live in `inputType` + `applies`. Presentation lives in `uiHint`. `uiHint` NEVER
   affects math, validation, or persistence.** A service whose `uiHint` values are all deleted
   still prices identically.
2. **`key` values are carried verbatim from the pricing source (id-alignment contract), never
   slugged from labels.** Key regex `^[a-z0-9]+(?:-[a-z0-9]+)*$` (Elevate parity).
3. **All money is integer cents** (`priceDelta Int`), engine math is integer minor-unit math.
4. Adding a service touches only `prisma/seed-data/apex-pricing.v1.json`,
   `prisma/seed-data/apex-catalog.json`, and a `prisma:seed` run. Adding a new *input semantic*
   is a code change (section 10 below is the honesty note).
5. In MVP the seed is the only writer of these tables (admin CRUD is post-MVP; when added it
   follows Elevate's nested `services/config` sub-router pattern with reorder endpoints).

## 2. UI control to `ConfigInputType` + `uiHint` mapping (pinned)

`ConfigInputType { SELECT MULTISELECT QUANTITY TOGGLE TEXTAREA }` (Prisma-owned, re-exported via
`src/enums`). The enum extends Elevate's two selection types to align with the published P14-M2
client contract's modifier types (`select | multiselect | quantity | toggle`) plus `TEXTAREA` for
QUOTE capture -- this extension is foundation-pinned, not introduced here.

| UI control (frontend) | inputType | uiHint | Notes |
|---|---|---|---|
| Dropdown | `SELECT` | `null` | Author note: `SELECT` + `null` renders as dropdown OR radio cards at the frontend's discretion (suggested heuristic: <= 5 options = radio cards, > 5 = dropdown). The server does not distinguish them -- both are exactly-one selection. |
| Radio cards | `SELECT` | `null` | Same row as above, intentionally. |
| Cleaning matrix row (beds / baths / type) | `SELECT` | `"matrix-axis"` | The "matrix" is nothing but three SELECT groups plus a frequency group; the hint tells the UI to compose them into the matrix widget. Math is identical to plain SELECTs. |
| Visual truck load estimator (junk removal) | `SELECT` | `"load-estimator"` | Frontend renders the truck-fill graphic; server sees an ordinary exactly-one SELECT. This is one of the PRD's shared assets Apex deposits for future brands. |
| Device checklist (smart home) | `MULTISELECT` | `"device-checklist"` | Zero-or-more (bounded) option keys as `string[]`. |
| Frequency selector (cleaning, pool) | `SELECT` | `"frequency"` | Options carry `priceDelta 0`; the percent discounts come from `ServicePricingRule` rows, never from the option deltas. |
| Numeric stepper | `QUANTITY` | `null` | Transported as a JSON number; resolved against enumerated integer option keys (section 8.2 pins the semantics). |
| Toggle / single checkbox | `TOGGLE` | `null` | Transported as a JSON boolean; optionless group, price from group-level `priceDelta`. |
| Description textarea (QUOTE services) | `TEXTAREA` | `null` | Declares the requirement; the VALUE travels as `configuration.description`, never inside `selections` (section 6 pins this). |

### 2.1 The `uiHint` contract

- **Presentation-only, forever.** No server code path (validation, pricing, persistence,
  serialization filtering) may branch on `uiHint`. A grep for `uiHint` outside serializers and
  seed code should return nothing; treat a hit as a review defect.
- **Stored as `String?`, not a Prisma enum.** Decision:

| Option | Verdict |
|---|---|
| Prisma enum `ConfigUiHint` | Rejected: every new visual treatment would need a migration, contradicting "presentation-only". |
| `String?` free text | **Chosen.** New hints ship as seed edits. The seed validates values against the known list `["matrix-axis", "load-estimator", "device-checklist", "frequency"]` (or `null`) and fails on typos, so the DB stays clean without a migration lock-in. |

- **Client fallback rule:** a client that does not recognize a `uiHint` value MUST fall back to the
  default renderer for the group's `inputType` (e.g. an unknown-hint SELECT renders as a plain
  dropdown). This is what makes new hints additive.

## 3. The id-alignment contract, restated for Apex

Verified Elevate ground truth (`Server/docs/service-configuration-model.md`,
`Client/brands/elevate/pricing.v1.json`): configuration rows and the pricing table are two views
of the same identifiers.

For every PRICED and FROM service (pricing table entry `services[service.pricingRef]` in
`apex-pricing.v1.json`):

1. `ServiceConfigGroup.key == modifiers[].id` -- **verbatim, character for character.** Never
   derived by slugging the label.
2. `ServiceConfigOption.key == modifiers[].options[].id` -- verbatim.
3. Runtime resolution (identical to the ported engine, `03-pricing-engine.md`):
   `selections[group.key]` -> normalize to an array of ids -> each id resolves to
   `option.key` -> delta = `option.priceDelta ?? group.priceDelta` -> apply per
   `group.applies` (`FLAT` once, `PER_UNIT` scaled by `configuration.quantity`).
4. `BookingConfiguration.selections` persists the SAME keyed shape
   (`Record<group.key, string | number | boolean | string[]>`) as an immutable snapshot.

**TEXTAREA groups are exempt by definition.** They have no pricing semantics, so they have no
counterpart modifier in the pricing table. The alignment set is exactly the groups whose
`inputType` is `SELECT | MULTISELECT | QUANTITY | TOGGLE` on a PRICED or FROM service. QUOTE
services keep an EMPTY pricing entry (`base_price 0, modifiers [], fees [], rules []`) so
`pricingRef` always resolves and the seed validates one uniform pass; the engine never reads it
because the QUOTE `PricingModeHandler` short-circuits before the engine (`03-pricing-engine.md`
section 7.2).

**Why misalignment is dangerous, not just untidy:** the ported engine iterates the pricing table's
modifiers and looks up `selections[m.id]`, skipping anything it does not find (verified against
`Client/src/lib/pricing/engine.ts`). A group keyed `bed-rooms` against a modifier keyed `bedrooms`
does not throw -- it silently prices the booking without the bedroom charge. Alignment failures
are therefore money bugs that no runtime error surfaces. The defense is (a) the seed guarantees
below and (b) the selection validator rejecting unknown keys BEFORE the engine's forgiving-skip
behavior can eat them (section 8).

## 4. How the seed guarantees alignment

Two seed-data files (paths pinned by the foundation spec; formats owned by `02-database.md`
sections 6.1-6.2 -- this section restates the alignment semantics, it does not define a second
pipeline):

- `prisma/seed-data/apex-pricing.v1.json` -- MONEY + MODES + RULES: the extended Elevate table
  `{ version, currency, note, services: { [pricingRef]: { mode, base_price, from_price?,
  modifiers[], fees[], rules[] } } }`. This file is the **single source of truth for pricing
  ids, deltas, modes, and conditional rules**. Every service has an entry -- QUOTE services get
  an EMPTY one (`base_price 0, modifiers [], fees [], rules []`) so `pricingRef` always resolves
  and the seed validator runs one uniform pass (per `03-pricing-engine.md` section 7.2).
- `prisma/seed-data/apex-catalog.json` -- STRUCTURE + COPY: categories; services (slug, name,
  summary, badges, `claimsBlock`, recurring eligibility, sort order); and the full group/choice
  declarations (`config_options[]` with verbatim ids, labels, sublabels, input types, required
  flags, `uiHint`s, bounds). It carries NO money, no mode, no rules.

`prisma/seed.ts` (listing owned by `02-database.md` section 6.3) walks the CATALOG structure and
joins each group/choice to its pricing counterpart by verbatim id:

```
for each service in apex-catalog.json:
  entry = apexPricing.services[service.pricing_ref]    // missing entry -> throw, seed aborts
  assertAligned(service, entry)                        // BEFORE any write (02 section 6.4)
  upsert Service { pricingMode: entry.mode, basePrice: entry.base_price.amount,
                   fromPrice: entry.from_price?.amount ?? null, ... }
  resync config rows (delete-and-recreate, Elevate precedent):
    for each group in service.config_options:          // catalog owns structure + labels
      create ServiceConfigGroup { key: group.id,       // verbatim -- never slugged
        label, inputType: mapType(group.input), uiHint, isRequired, sortOrder: index, ... }
      for each choice in group.choices:
        create ServiceConfigOption { key: choice.id, label, sublabel,
          priceDelta: deltaFor(pricing_ref, group.id, choice.id) }   // money joined from pricing
  resync ServicePricingRule rows from entry.rules[]    // rules live in the PRICING file
```

Guarantees, in order of enforcement:

1. **Alignment asserted before any write:** `assertAligned` (listing in `02-database.md` 6.4)
   requires every non-TEXTAREA catalog group id to exist as a pricing modifier id under the
   service's `pricing_ref`, every choice id to exist in that modifier's options, and every rule
   trigger to resolve to a real group (and option, for `option_selected`). One miss fails the
   whole seed with a named path. Keys are only ever COPIED from source ids -- there is no
   slugify call in seed.ts, by construction.
2. **Reverse-direction warning:** a pricing modifier with no catalog group is unreachable money,
   logged `[id-alignment][warn]` (not fatal -- it prices nothing).
3. **Key lint:** every key must match `^[a-z0-9]+(?:-[a-z0-9]+)*$` (numeric keys such as `"3"`
   match). `uiHint` must be in the known list or `null`. TOGGLE groups must have
   `isRequired: false`, a non-null group `priceDelta`, and zero options. QUANTITY groups must
   have `quantityMin`/`quantityMax` (the QUANTITY-specific bound columns, `02-database.md`
   decision #8) and options enumerating exactly the integer keys `String(quantityMin) ..
   String(quantityMax)`. TEXTAREA groups must have zero options and appear only on QUOTE
   services in MVP seed data. (No MVP seed row uses QUANTITY or TOGGLE -- see 5.12.)
4. **Idempotency:** services upsert by slug; config rows resync by delete-and-recreate keyed on
   `@@unique([serviceId, key])` / `@@unique([groupId, key])`, so re-running `prisma:seed`
   converges instead of duplicating.
5. **Runtime source is the DB.** The pricing module composes the engine's `ServicePricingData`
   from these seeded rows (mapper owned by `03-pricing-engine.md`); the JSON files are seed
   inputs only, never read at request time. One source of truth per environment.

## 5. Declarative definitions for all 11 services (the seed blueprint)

Conventions for the listings below:

- All `priceDelta` values are **integer cents**. `basePrice` is the `Service.basePrice` column.
- Provenance column: **verified** = taken from Apex frontend data files (path cited per service);
  **SAMPLE** = fabricated placeholder pending product-owner confirmation (mirrors Elevate's
  "SAMPLE PLACEHOLDER PRICES" note; `apex-pricing.v1.json` carries the same `note` string).
- Decision (foundation spec offered two encodings for the cleaning matrix):

| Option | Verdict |
|---|---|
| `basePrice 9500` + type deltas `0 / 5000 / 10000` | Rejected: makes cleaning the only service whose SELECT deltas are relative to a nonzero base; complicates the "every combination exact" audit. |
| `basePrice 0` + type deltas `9500 / 14500 / 19500` | **Chosen, and generalized:** every service in the MVP seed uses `basePrice 0` with absolute option deltas. Uniform pattern; the engine's `base * quantity` step contributes 0 and still emits a $0.00 "Base" line item (unconditional emission is Elevate port fidelity, `03-pricing-engine.md` section 4.3; hiding zero lines is a frontend rendering choice). |

- Sublabels are normalized to US-ASCII in seed data (`"Up to 1/4 acre"`, not the frontend's
  fraction glyphs); the frontend may render fancier glyphs from the same data.
- Every group below is `status ACTIVE`, `applies FLAT` unless stated. `sortOrder` is the listed
  order. Rule `effect` values shown as `percent N` mean
  `{ "kind": "discount", "calc": "percent", "value": N }` evaluated against the running subtotal
  with `Math.round(subtotal * value / 100)` (foundation-pinned rounding).

### 5.1 `cleaning` -- Home Cleaning (PRICED, pricingRef `cleaning`, basePrice 0)

Verified source: `client/src/data/HouseCleaningData/configuratorData.ts` (dollars, converted to
cents): Standard $95 / Deep $145 / Move In-Out $195; +$25 per bedroom; +$15 per bathroom.

| # | group key | label | inputType | uiHint | required |
|---|---|---|---|---|---|
| 0 | `cleaning-type` | Cleaning type | SELECT | `matrix-axis` | yes |
| 1 | `bedrooms` | Bedrooms | SELECT | `matrix-axis` | yes |
| 2 | `bathrooms` | Bathrooms | SELECT | `matrix-axis` | yes |
| 3 | `frequency` | Frequency | SELECT | `frequency` | yes |

| group | option key | label | priceDelta | provenance |
|---|---|---|---|---|
| cleaning-type | `standard` | Standard | 9500 | verified |
| cleaning-type | `deep` | Deep Clean | 14500 | verified |
| cleaning-type | `move-in-out` | Move In/Out | 19500 | verified |
| bedrooms | `1` | 1 bedroom | 2500 | verified (n * 2500) |
| bedrooms | `2` | 2 bedrooms | 5000 | verified |
| bedrooms | `3` | 3 bedrooms | 7500 | verified |
| bedrooms | `4` | 4 bedrooms | 10000 | verified |
| bedrooms | `5` | 5 bedrooms | 12500 | verified |
| bathrooms | `1` | 1 bathroom | 1500 | verified (n * 1500) |
| bathrooms | `2` | 2 bathrooms | 3000 | verified |
| bathrooms | `3` | 3 bathrooms | 4500 | verified |
| bathrooms | `4` | 4 bathrooms | 6000 | verified |
| frequency | `one-time` | One-time | 0 | verified (axis exists per PRD) |
| frequency | `weekly` | Weekly | 0 | verified (axis) |
| frequency | `biweekly` | Every two weeks | 0 | verified (axis) |
| frequency | `monthly` | Monthly | 0 | verified (axis) |

Rules (`ServicePricingRule`):

| key | label | trigger | effect | provenance |
|---|---|---|---|---|
| `freq-weekly-discount` | Weekly discount (Sample) | `{ "kind": "option_selected", "group": "frequency", "option": "weekly" }` | percent 20 | SAMPLE (foundation placeholder) |
| `freq-biweekly-discount` | Bi-weekly discount (Sample) | `{ "kind": "option_selected", "group": "frequency", "option": "biweekly" }` | percent 15 | SAMPLE |
| `freq-monthly-discount` | Monthly discount (Sample) | `{ "kind": "option_selected", "group": "frequency", "option": "monthly" }` | percent 10 | SAMPLE |

`one-time` has no rule (0 percent). Acceptance criterion: every beds x baths x type x frequency
combination must be exact -- with absolute integer deltas and a single percent rounding at the
end, each of the 5 x 4 x 3 x 4 = 240 combinations is a deterministic integer (the pricing section
carries the exhaustive test).

### 5.2 `lawn-care` -- Lawn Care (PRICED, pricingRef `lawn-care`, basePrice 0)

Verified source: `client/src/data/LawnCareData/sizeSelectorData.ts`.

| # | group key | label | inputType | uiHint | required |
|---|---|---|---|---|---|
| 0 | `lot-size` | Lot size | SELECT | `null` (radio cards) | yes |

| option key | label | sublabel | priceDelta | provenance |
|---|---|---|---|---|
| `small` | Small yard | Up to 1/4 acre | 4500 | verified |
| `medium` | Medium yard | 1/4 to 1/2 acre | 6500 | verified |
| `large` | Large yard | 1/2 to 1 acre | 9000 | verified |
| `xlarge` | Extra large yard | 1+ acre | 13000 | verified |

Rules: none. (`Service.isRecurringEligible = true`; a frequency axis is NOT in the verified
frontend data -- flagged as an open question, adding one later is a seed change.)

### 5.3 `junk-removal` -- Junk Removal (PRICED, pricingRef `junk-removal`, basePrice 0)

| # | group key | label | inputType | uiHint | required |
|---|---|---|---|---|---|
| 0 | `load-size` | How full is the truck? | SELECT | `load-estimator` | yes |

| option key | label | sublabel | priceDelta | provenance |
|---|---|---|---|---|
| `quarter` | 1/4 truck | A few items or one closet | 9900 | SAMPLE |
| `half` | 1/2 truck | A one-room cleanout | 17900 | SAMPLE |
| `three-quarter` | 3/4 truck | Several rooms of furniture | 24900 | SAMPLE |
| `full` | Full truck | Whole-garage or whole-home cleanout | 32900 | SAMPLE |

Rules: none. Option keys `quarter / half / three-quarter / full` are pinned by the PRD's load
estimator; the truck-fill visual is pure `uiHint` -- the server sees an exactly-one SELECT.

### 5.4 `pool` -- Pool Care (PRICED, pricingRef `pool`, basePrice 0)

Verified source: `client/src/data/PoolData/poolData.ts` (sizes and frequencies).

| # | group key | label | inputType | uiHint | required |
|---|---|---|---|---|---|
| 0 | `pool-size` | Pool size | SELECT | `null` | yes |
| 1 | `frequency` | Service frequency | SELECT | `frequency` | yes |

| group | option key | label | sublabel | priceDelta | provenance |
|---|---|---|---|---|---|
| pool-size | `small` | Small pool | Up to 15,000 gal | 8900 | verified |
| pool-size | `medium` | Medium pool | 15,000 to 25,000 gal | 12000 | verified |
| pool-size | `large` | Large pool | 25,000 to 40,000 gal | 15900 | verified |
| pool-size | `custom` | Custom pool | Over 40,000 gal | 19900 | verified |
| frequency | `weekly` | Weekly | -- | 0 | verified |
| frequency | `biweekly` | Every two weeks | -- | 0 | verified |
| frequency | `monthly` | Monthly | -- | 0 | verified |

Rules:

| key | label | trigger | effect | provenance |
|---|---|---|---|---|
| `freq-monthly-discount` | Monthly visit discount | `{ "kind": "option_selected", "group": "frequency", "option": "monthly" }` | percent 15 | derived from verified frontend `multiplier: 0.85` -- confirm intent (open question) |

### 5.5 `pest-control` -- Pest Control (PRICED, pricingRef `pest-control`, basePrice 0)

Verified source for pest-type keys: `client/src/data/PestControlData/pestSelectorData.ts`
(no prices in frontend data; all cents SAMPLE).

| # | group key | label | inputType | uiHint | required |
|---|---|---|---|---|---|
| 0 | `plan` | Protection plan | SELECT | `null` | yes |
| 1 | `pest-type` | What are you dealing with? | SELECT | `null` | yes |

| group | option key | label | sublabel | priceDelta | provenance |
|---|---|---|---|---|---|
| plan | `one-time` | One-time treatment | -- | 19900 | SAMPLE |
| plan | `quarterly` | Quarterly plan | Price per visit | 9900 | SAMPLE |
| plan | `monthly` | Monthly plan | Price per visit | 7900 | SAMPLE |
| pest-type | `general` | General prevention | -- | 0 | keys verified, delta 0 (pro-routing info) |
| pest-type | `indoor` | Indoor issue | -- | 0 | keys verified, delta 0 |
| pest-type | `outdoor` | Outdoor issue | -- | 0 | keys verified, delta 0 |
| pest-type | `rodent` | Rodents / wildlife | -- | 0 | keys verified, delta 0 |

Rules: none. `Service.claimsBlock` carries the NC pesticide-license expectation copy (collected
from pros as an acknowledgement, never verified -- PRD).

### 5.6 `smart-home` -- Smart Home Install (PRICED, pricingRef `smart-home`, basePrice 0)

| # | group key | label | inputType | uiHint | required | bounds |
|---|---|---|---|---|---|---|
| 0 | `devices` | Devices to install | MULTISELECT | `device-checklist` | yes | selectMin 1, selectMax null |

| option key | label | priceDelta | provenance |
|---|---|---|---|
| `smart-plug-hub` | Smart plug / hub | 4900 | SAMPLE |
| `video-doorbell` | Video doorbell | 9900 | SAMPLE |
| `security-camera` | Security camera | 11900 | SAMPLE |
| `smart-thermostat` | Smart thermostat | 12900 | SAMPLE |
| `smart-lock` | Smart lock | 14900 | SAMPLE |

Rules:

| key | label | trigger | effect | provenance |
|---|---|---|---|---|
| `multi-device-discount` | 3+ device bundle discount | `{ "kind": "min_selected", "group": "devices", "count": 3 }` | percent 15 | PRD-mandated (threshold EXACTLY >= 3; percent 15 pinned) |

Acceptance criterion restated: 2 devices selected -> no discount line item; 3 devices -> exactly
one `discount` line item at 15 percent of the running subtotal. The threshold and percent are
rule DATA, never client-asserted (the pipeline recomputes; see `06-pipeline-shared-roadmap.md`).

### 5.7 `power-washing` -- Power Washing (FROM, pricingRef `power-washing`, basePrice 0, fromPrice 9900 SAMPLE)

`fromPrice` is display-only ("From $99"), never summed into math (Elevate parity). The engine
still runs on FROM services to produce the "from" subtotal for the selected options.

| # | group key | label | inputType | uiHint | required | bounds |
|---|---|---|---|---|---|---|
| 0 | `surfaces` | Surfaces | MULTISELECT | `null` (checkbox cards) | yes | selectMin 1, selectMax null |

| group | option key | label | priceDelta | provenance |
|---|---|---|---|---|
| surfaces | `fence` | Fence | 9900 | SAMPLE |
| surfaces | `driveway-sidewalk` | Driveway / sidewalk | 12900 | SAMPLE |
| surfaces | `deck-patio` | Deck / patio | 14900 | SAMPLE |
| surfaces | `house-siding` | House siding | 19900 | SAMPLE |

Rules: none. A customer picks one or more surfaces; the engine sums every selected delta
(MULTISELECT semantics, one line item per selected key). The FROM band framing ("From $99,
final pricing confirmed by your pro") comes from the mode handler, not from this data.

### 5.8 `handyman` -- Handyman (FROM, pricingRef `handyman`, basePrice 0, fromPrice 6500 SAMPLE)

| # | group key | label | inputType | uiHint | required |
|---|---|---|---|---|---|
| 0 | `job-type` | What do you need done? | SELECT | `null` | yes |

| group | option key | label | sublabel | priceDelta | provenance |
|---|---|---|---|---|---|
| job-type | `small-repair` | Small repair | -- | 6500 | SAMPLE |
| job-type | `furniture-assembly` | Furniture assembly | -- | 7900 | SAMPLE |
| job-type | `fixture-install` | Fixture install | -- | 8900 | SAMPLE |
| job-type | `tv-mounting` | TV mounting | -- | 9900 | SAMPLE |

Rules: none. Longer or multi-task visits are exactly what the FROM framing exists for: the
selected job type anchors the band and the pro confirms final pricing. (An `estimated-hours`
QUANTITY group was considered and dropped from the MVP seed -- no verified frontend data backs
it; adding it later is a seed change plus, if bounds are wanted, the already-modeled
`quantityMin`/`quantityMax` columns.)

### 5.9 `painting` -- Painting (QUOTE, pricingRef `painting`, basePrice 0)

| # | group key | label | inputType | uiHint | required |
|---|---|---|---|---|---|
| 0 | `description` | Tell us about your project | TEXTAREA | `null` | yes |

No options, no rules, no pricing-table entry. The QUOTE `PricingModeHandler` returns
`{ mode: "QUOTE", displayed_price: null, requires_description: true }` without running the engine.

### 5.10 `home-security` -- Home Security (QUOTE, pricingRef `home-security`, basePrice 0)

| # | group key | label | inputType | uiHint | required |
|---|---|---|---|---|---|
| 0 | `description` | Tell us about your home and goals | TEXTAREA | `null` | yes |

No options, no rules. `Service.claimsBlock` carries the NC alarm-license framing ("free consult";
license expectations displayed, never verified -- PRD).

### 5.11 `tree-stump` -- Tree & Stump Removal (QUOTE, pricingRef `tree-stump`, basePrice 0)

| # | group key | label | inputType | uiHint | required |
|---|---|---|---|---|---|
| 0 | `description` | Describe the tree or stump work | TEXTAREA | `null` | yes |

No options, no rules. `claimsBlock` carries any arborist/insurance expectation copy.

### 5.12 Coverage check

Live seed coverage: SELECT (eight services), MULTISELECT (smart-home, power-washing), TEXTAREA
(three QUOTE services). Every pinned `uiHint` value has a live row: `matrix-axis` (cleaning),
`load-estimator` (junk-removal), `device-checklist` (smart-home), `frequency` (cleaning, pool).
Both rule trigger kinds have live rows: `min_selected` (smart-home) and `option_selected`
(cleaning, pool). **QUANTITY and TOGGLE have NO live seed rows** -- they are modeled (schema
columns, engine semantics, validator branches) because the Elevate contract defines them, but no
verified MVP data uses them; their code paths are exercised by unit tests only, and the first
future service that needs one is a seed change, not a migration (`02-database.md` decision #8).

## 6. QUOTE configurators and the description channel

The PRD contract says QUOTE verticals carry `configuration.description`. The TEXTAREA group also
has a key named `description`, which creates a potential second home for the text inside
`selections`. Pinned decision:

| Option | Verdict |
|---|---|
| Canonical in `selections["description"]` (string selection) | Rejected: violates the published P14-M2 selections value semantics (option keys / numbers / booleans, not free prose), bloats the immutable selections snapshot with PII-adjacent text, and contradicts the PRD's literal `configuration.description`. |
| Canonical in `configuration.description` -> `BookingConfiguration.description` | **Chosen.** The wire shape is the P14-M2 `configuration` object extended with an optional `description` field (additive extension, QUOTE-only). Persisted to the `BookingConfiguration.description` column, never inside `selections`. |
| Normalize `selections["description"]` into `configuration.description` when only the former is sent | Rejected in favor of rejection: silent normalization creates ambiguity when both are present with different values and hides frontend contract bugs. |

Enforcement (the selection validator, section 8):

- Any `selections` key that resolves to a TEXTAREA group is rejected with 422, violation code
  `TEXTAREA_IN_SELECTIONS`, message pointing the client at `configuration.description`.
- QUOTE service: `configuration.description` required, trimmed length >= 10 (foundation-pinned
  minimum) and <= 2000 (proposed cap; open question below).
- PRICED / FROM service: `configuration.description` present -> 422 `DESCRIPTION_NOT_ALLOWED`
  (free text belongs in the top-level booking `notes` field). This keeps the acceptance-criteria
  invariant biconditional: a booking carries `configuration.description` if and only if it is a
  QUOTE booking, and QUOTE bookings never carry a `displayed_price`
  (`BookingConfiguration.priceTotal` stays NULL).

The TEXTAREA group row still earns its keep on QUOTE services: it drives the UI (label, required
flag, ordering) from the same `GET .../config` payload as every other input, keeps QUOTE services
inside the "zero custom code" model, and lets a future service mix a TEXTAREA with priced groups
without a schema change.

## 7. `GET /services/:idOrSlug/config` response contract

One round trip gives the booking UI everything: the service, its ordered ACTIVE groups with
ordered ACTIVE options, the pricing mode, and an ACTIVE-rules summary. The shape is Elevate's
`ServiceWithConfigResponse` (verified against
`Server/src/modules/services/config/service-config.types.ts`) with the following delta --
**called out explicitly as additive plus foundation-pinned renames**:

| Change | Kind | Note |
|---|---|---|
| `pricingMode` on the service | additive | `"PRICED" \| "FROM" \| "QUOTE"` -- the UI's step-3 dispatch value. |
| `uiHint`, `applies`, `priceDelta`, `selectMin`, `selectMax` on groups | additive | New group semantics/presentation fields. |
| `sublabel` on options | rename (foundation-pinned) | Elevate calls this column `description`; Apex pins `sublabel`. |
| `inputType` on groups | rename (foundation-pinned) | Elevate serializes `selectionType`; Apex pins `inputType ConfigInputType`. |
| `priceDelta` on options | rename (foundation-pinned) | Elevate serializes `priceModifier`. |
| `basePrice` on the service | rename (foundation-pinned) | Elevate serializes `priceAmount`; Apex's model pins `basePrice`. |
| `rules[]` on the response root | additive | ACTIVE `ServicePricingRule` rows as `{ key, label, trigger, effect, sortOrder }`, raw declarative JSON plus a display label (e.g. "3+ device bundle discount"). Safe to expose: it is public pricing information the UI must explain anyway. |
| `claimsBlock`, `isRecurringEligible`, `categoryId` on the service | additive | Apex model fields. |
| Dropped: `durationMinutes`, `locationMode(s)`, `serviceType`, `minBooking`, `iconPath` | removal | No counterpart in the Apex `Service` model (wellness-domain fields). |

Serving rules (Elevate parity unless noted): groups and options ordered by `sortOrder`; ACTIVE
rows only; a group is served only if ACTIVE **and** -- for option-bearing input types
(SELECT/MULTISELECT/QUANTITY) -- has >= 1 ACTIVE option.

Deviation: Elevate's "group is ACTIVE only if it has >= 1 option" guard is scoped in Apex to
option-bearing input types -- justified by the foundation-pinned TOGGLE and TEXTAREA input types,
which are optionless by design (TOGGLE prices from the group-level `priceDelta`; TEXTAREA has no
price semantics).

### 7.1 Full example: cleaning (the matrix service)

`GET /api/v1/services/cleaning/config` (UUIDs and timestamps abbreviated to readable placeholders;
real values are UUID strings and ISO datetimes):

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "id": "uuid-svc-cleaning",
    "categoryId": "uuid-cat-recurring-core",
    "name": "Home Cleaning",
    "slug": "cleaning",
    "summary": "Recurring or one-time cleaning, priced by beds, baths, and clean type.",
    "description": "Professional home cleaning across Wake County. Standard, deep, and move in/out cleans.",
    "pricingMode": "PRICED",
    "pricingRef": "cleaning",
    "basePrice": 0,
    "fromPrice": null,
    "currency": "USD",
    "badges": ["Background-checked pros", "Supplies included"],
    "claimsBlock": null,
    "isRecurringEligible": true,
    "sortOrder": 0,
    "status": "ACTIVE",
    "configGroups": [
      {
        "id": "uuid-grp-cleaning-type",
        "serviceId": "uuid-svc-cleaning",
        "key": "cleaning-type",
        "label": "Cleaning type",
        "inputType": "SELECT",
        "uiHint": "matrix-axis",
        "applies": "FLAT",
        "isRequired": true,
        "priceDelta": null,
        "selectMin": null,
        "selectMax": null,
        "sortOrder": 0,
        "status": "ACTIVE",
        "options": [
          { "id": "uuid-opt-standard", "key": "standard", "label": "Standard", "sublabel": null, "priceDelta": 9500, "sortOrder": 0, "status": "ACTIVE", "createdAt": "2026-07-06T00:00:00.000Z", "updatedAt": "2026-07-06T00:00:00.000Z" },
          { "id": "uuid-opt-deep", "key": "deep", "label": "Deep Clean", "sublabel": null, "priceDelta": 14500, "sortOrder": 1, "status": "ACTIVE", "createdAt": "2026-07-06T00:00:00.000Z", "updatedAt": "2026-07-06T00:00:00.000Z" },
          { "id": "uuid-opt-move-in-out", "key": "move-in-out", "label": "Move In/Out", "sublabel": null, "priceDelta": 19500, "sortOrder": 2, "status": "ACTIVE", "createdAt": "2026-07-06T00:00:00.000Z", "updatedAt": "2026-07-06T00:00:00.000Z" }
        ],
        "createdAt": "2026-07-06T00:00:00.000Z",
        "updatedAt": "2026-07-06T00:00:00.000Z"
      },
      {
        "id": "uuid-grp-bedrooms",
        "serviceId": "uuid-svc-cleaning",
        "key": "bedrooms",
        "label": "Bedrooms",
        "inputType": "SELECT",
        "uiHint": "matrix-axis",
        "applies": "FLAT",
        "isRequired": true,
        "priceDelta": null,
        "selectMin": null,
        "selectMax": null,
        "sortOrder": 1,
        "status": "ACTIVE",
        "options": [
          { "id": "uuid-opt-bed-1", "key": "1", "label": "1 bedroom", "sublabel": null, "priceDelta": 2500, "sortOrder": 0, "status": "ACTIVE", "createdAt": "2026-07-06T00:00:00.000Z", "updatedAt": "2026-07-06T00:00:00.000Z" },
          { "id": "uuid-opt-bed-2", "key": "2", "label": "2 bedrooms", "sublabel": null, "priceDelta": 5000, "sortOrder": 1, "status": "ACTIVE", "createdAt": "2026-07-06T00:00:00.000Z", "updatedAt": "2026-07-06T00:00:00.000Z" },
          { "id": "uuid-opt-bed-3", "key": "3", "label": "3 bedrooms", "sublabel": null, "priceDelta": 7500, "sortOrder": 2, "status": "ACTIVE", "createdAt": "2026-07-06T00:00:00.000Z", "updatedAt": "2026-07-06T00:00:00.000Z" },
          { "id": "uuid-opt-bed-4", "key": "4", "label": "4 bedrooms", "sublabel": null, "priceDelta": 10000, "sortOrder": 3, "status": "ACTIVE", "createdAt": "2026-07-06T00:00:00.000Z", "updatedAt": "2026-07-06T00:00:00.000Z" },
          { "id": "uuid-opt-bed-5", "key": "5", "label": "5 bedrooms", "sublabel": null, "priceDelta": 12500, "sortOrder": 4, "status": "ACTIVE", "createdAt": "2026-07-06T00:00:00.000Z", "updatedAt": "2026-07-06T00:00:00.000Z" }
        ],
        "createdAt": "2026-07-06T00:00:00.000Z",
        "updatedAt": "2026-07-06T00:00:00.000Z"
      },
      {
        "id": "uuid-grp-bathrooms",
        "serviceId": "uuid-svc-cleaning",
        "key": "bathrooms",
        "label": "Bathrooms",
        "inputType": "SELECT",
        "uiHint": "matrix-axis",
        "applies": "FLAT",
        "isRequired": true,
        "priceDelta": null,
        "selectMin": null,
        "selectMax": null,
        "sortOrder": 2,
        "status": "ACTIVE",
        "options": [
          { "id": "uuid-opt-bath-1", "key": "1", "label": "1 bathroom", "sublabel": null, "priceDelta": 1500, "sortOrder": 0, "status": "ACTIVE", "createdAt": "2026-07-06T00:00:00.000Z", "updatedAt": "2026-07-06T00:00:00.000Z" },
          { "id": "uuid-opt-bath-2", "key": "2", "label": "2 bathrooms", "sublabel": null, "priceDelta": 3000, "sortOrder": 1, "status": "ACTIVE", "createdAt": "2026-07-06T00:00:00.000Z", "updatedAt": "2026-07-06T00:00:00.000Z" },
          { "id": "uuid-opt-bath-3", "key": "3", "label": "3 bathrooms", "sublabel": null, "priceDelta": 4500, "sortOrder": 2, "status": "ACTIVE", "createdAt": "2026-07-06T00:00:00.000Z", "updatedAt": "2026-07-06T00:00:00.000Z" },
          { "id": "uuid-opt-bath-4", "key": "4", "label": "4 bathrooms", "sublabel": null, "priceDelta": 6000, "sortOrder": 3, "status": "ACTIVE", "createdAt": "2026-07-06T00:00:00.000Z", "updatedAt": "2026-07-06T00:00:00.000Z" }
        ],
        "createdAt": "2026-07-06T00:00:00.000Z",
        "updatedAt": "2026-07-06T00:00:00.000Z"
      },
      {
        "id": "uuid-grp-frequency",
        "serviceId": "uuid-svc-cleaning",
        "key": "frequency",
        "label": "Frequency",
        "inputType": "SELECT",
        "uiHint": "frequency",
        "applies": "FLAT",
        "isRequired": true,
        "priceDelta": null,
        "selectMin": null,
        "selectMax": null,
        "sortOrder": 3,
        "status": "ACTIVE",
        "options": [
          { "id": "uuid-opt-freq-onetime", "key": "one-time", "label": "One-time", "sublabel": null, "priceDelta": 0, "sortOrder": 0, "status": "ACTIVE", "createdAt": "2026-07-06T00:00:00.000Z", "updatedAt": "2026-07-06T00:00:00.000Z" },
          { "id": "uuid-opt-freq-weekly", "key": "weekly", "label": "Weekly", "sublabel": "Save 20% (SAMPLE)", "priceDelta": 0, "sortOrder": 1, "status": "ACTIVE", "createdAt": "2026-07-06T00:00:00.000Z", "updatedAt": "2026-07-06T00:00:00.000Z" },
          { "id": "uuid-opt-freq-biweekly", "key": "biweekly", "label": "Every two weeks", "sublabel": "Save 15% (SAMPLE)", "priceDelta": 0, "sortOrder": 2, "status": "ACTIVE", "createdAt": "2026-07-06T00:00:00.000Z", "updatedAt": "2026-07-06T00:00:00.000Z" },
          { "id": "uuid-opt-freq-monthly", "key": "monthly", "label": "Monthly", "sublabel": "Save 10% (SAMPLE)", "priceDelta": 0, "sortOrder": 3, "status": "ACTIVE", "createdAt": "2026-07-06T00:00:00.000Z", "updatedAt": "2026-07-06T00:00:00.000Z" }
        ],
        "createdAt": "2026-07-06T00:00:00.000Z",
        "updatedAt": "2026-07-06T00:00:00.000Z"
      }
    ],
    "rules": [
      { "key": "freq-weekly-discount", "label": "Weekly discount (Sample)", "trigger": { "kind": "option_selected", "group": "frequency", "option": "weekly" }, "effect": { "kind": "discount", "calc": "percent", "value": 20 }, "sortOrder": 1 },
      { "key": "freq-biweekly-discount", "label": "Bi-weekly discount (Sample)", "trigger": { "kind": "option_selected", "group": "frequency", "option": "biweekly" }, "effect": { "kind": "discount", "calc": "percent", "value": 15 }, "sortOrder": 2 },
      { "key": "freq-monthly-discount", "label": "Monthly discount (Sample)", "trigger": { "kind": "option_selected", "group": "frequency", "option": "monthly" }, "effect": { "kind": "discount", "calc": "percent", "value": 10 }, "sortOrder": 3 }
    ],
    "createdAt": "2026-07-06T00:00:00.000Z",
    "updatedAt": "2026-07-06T00:00:00.000Z"
  }
}
```

### 7.2 Full example: painting (QUOTE)

`GET /api/v1/services/painting/config`:

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "id": "uuid-svc-painting",
    "categoryId": "uuid-cat-one-time",
    "name": "Painting",
    "slug": "painting",
    "summary": "Interior and exterior painting. Custom quote required.",
    "description": "Tell us about your project and a coordinator will prepare a custom estimate.",
    "pricingMode": "QUOTE",
    "pricingRef": "painting",
    "basePrice": 0,
    "fromPrice": null,
    "currency": "USD",
    "badges": ["Custom estimate", "Coordinator confirmed"],
    "claimsBlock": null,
    "isRecurringEligible": false,
    "sortOrder": 5,
    "status": "ACTIVE",
    "configGroups": [
      {
        "id": "uuid-grp-painting-description",
        "serviceId": "uuid-svc-painting",
        "key": "description",
        "label": "Tell us about your project",
        "inputType": "TEXTAREA",
        "uiHint": null,
        "applies": "FLAT",
        "isRequired": true,
        "priceDelta": null,
        "selectMin": null,
        "selectMax": null,
        "sortOrder": 0,
        "status": "ACTIVE",
        "options": [],
        "createdAt": "2026-07-06T00:00:00.000Z",
        "updatedAt": "2026-07-06T00:00:00.000Z"
      }
    ],
    "rules": [],
    "createdAt": "2026-07-06T00:00:00.000Z",
    "updatedAt": "2026-07-06T00:00:00.000Z"
  }
}
```

The UI reads `pricingMode: "QUOTE"` + the TEXTAREA group and renders the textarea, submits the
prose as `configuration.description`, shows "custom estimate" instead of a live price, and the
booking response carries no `displayed_price`.

The sibling preview endpoint `POST /services/:idOrSlug/config/price` accepts
`{ selections, quantity? }` -- this is pinned Deviation 4 from Elevate's `{ optionIds: string[] }`
body, justified by the P14-M2 keyed-selections contract (matrix and quantity semantics cannot be
expressed as a flat option-id list). Request/response examples live in `05-api-and-validation.md`.

## 8. Selection-validation semantics: config engine vs pricing engine

The ported engine is deliberately forgiving (verified `engine.ts` behavior): unknown selection
keys are never read (it iterates the pricing table's modifiers), unknown option ids resolve to
the group delta or nothing, `false`/`null` selections are skipped. That forgiveness is
parity-load-bearing -- so **all strictness lives upstream in the selection validator**, which
must run before any engine call. A typo that reaches the engine is a silent underprice; a typo
that reaches the validator is a 422.

| Concern | Config engine (selection validator) | Pricing engine / mode handlers |
|---|---|---|
| Service exists and is ACTIVE | yes (reference validation, with the transport layer; see `05-api-and-validation.md`) | assumes valid |
| Unknown `selections` keys | rejects (`UNKNOWN_SELECTION_KEY`) | would silently ignore -- must never see them |
| Unknown option keys | rejects (`UNKNOWN_OPTION_KEY`) | would fall back to group delta -- must never see them |
| Required groups present | yes (`MISSING_REQUIRED_GROUP`) | no concept of required |
| Value shape per inputType | yes (table below) | normalizes arrays only |
| MULTISELECT bounds and duplicates | yes | no |
| QUANTITY integer + bounds | yes | no |
| TEXTAREA / description channel | yes (section 6 rules) | QUOTE handler never runs the engine |
| `quantity` (top-level) bounds | yes (int, 1..99) | scales base and PER_UNIT deltas |
| Price math, rules, rounding | no | yes (owned by `03-pricing-engine.md`) |
| Client total vs recomputed total | no | booking pipeline (422 `PRICE_MISMATCH`; `06-pipeline-shared-roadmap.md`) |
| `quoteRequest` flag | no | pipeline derives from `service.pricingMode`; client value ignored |

### 8.1 The validator (shared, brand-agnostic)

Pure function, zero Apex-specific imports, packaged per `06-pipeline-shared-roadmap.md` (consumed by
`modules/services/config` for the preview endpoint and by `modules/bookings` in the pipeline):

```ts
export type SelectionValue = string | number | boolean | string[];

export interface SelectionViolation {
  code: SelectionViolationCode;
  groupKey?: string;
  message: string;
}

export function validateSelections(input: {
  pricingMode: PricingMode;
  groups: ConfigGroupWithOptions[]; // ACTIVE groups with ACTIVE options, ordered
  selections: Record<string, SelectionValue>;
  quantity: number;
  description?: string | null;      // configuration.description
}):
  | { ok: true; normalized: { selections: Record<string, SelectionValue>; quantity: number; description: string | null } }
  | { ok: false; violations: SelectionViolation[] };
```

All violations are collected (not fail-fast) and surfaced through
`ApiError.unprocessable("Validation failed", details)` -> the standard 422 envelope, matching the
Elevate zod-details shape `{ path, message }` with `path = "selections." + groupKey` (or
`"description"`).

Violation codes (const map, SCREAMING_SNAKE per Elevate naming). The vocabulary is OWNED by the
error-code catalog in `05-api-and-validation.md` -- this validator emits exactly its codes, with
the specific shape failure carried in an `expected` detail field rather than a per-shape code:

- `MISSING_REQUIRED_GROUP` -- a required group has no selection.
- `UNKNOWN_SELECTION_KEY` / `UNKNOWN_OPTION_KEY` -- key does not resolve (id-alignment guard).
- `INVALID_SELECTION_VALUE` -- wrong JSON shape for the group's inputType (array where SELECT
  expects a string, non-array MULTISELECT, duplicate MULTISELECT entries, non-integer QUANTITY,
  non-boolean TOGGLE); details carry `{ groupKey, expected }` (e.g. `expected: "string"`,
  `expected: "unique string[]"`).
- `SELECTION_OUT_OF_BOUNDS` -- a count/range bound violated: MULTISELECT count outside
  `[selectMin, selectMax]`, QUANTITY value outside `[quantityMin, quantityMax]`, or the top-level
  `configuration.quantity` outside 1..99; details carry the bound that failed.
- `QUOTE_DESCRIPTION_REQUIRED` -- QUOTE service with missing/too-short description; details
  `{ min_length: 10 }`.
- `TEXTAREA_IN_SELECTIONS`, `DESCRIPTION_NOT_ALLOWED`, `DESCRIPTION_TOO_LONG` -- the description
  channel rules of section 6 (these three are contributed to 05's catalog by this section).

### 8.2 Per-inputType rules

| inputType | Accepted JSON shape | Validation rules | Engine resolution (parity note) |
|---|---|---|---|
| SELECT | `string` | Exactly one value; must equal an ACTIVE option key of the group. Arrays and non-strings -> `INVALID_SELECTION_VALUE` (`expected: "string"`). | `selections[key]` -> option -> `option.priceDelta`. |
| MULTISELECT | `string[]` | Array of unique strings (non-array or duplicates -> `INVALID_SELECTION_VALUE`), each an ACTIVE option key. Count within `[selectMin ?? (isRequired ? 1 : 0), selectMax ?? optionCount]`, else `SELECTION_OUT_OF_BOUNDS`. | Each id -> option delta; each emits its own `option` line item. |
| QUANTITY | `number` | Integer (else `INVALID_SELECTION_VALUE`); `quantityMin <= n <= quantityMax` (both non-null by seed lint; else `SELECTION_OUT_OF_BOUNDS`). `String(n)` must equal an ACTIVE option key. | `String(n)` is looked up as an option id -- identical math to SELECT. **Pinned:** QUANTITY does NOT multiply a unit delta by `n`; it resolves enumerated integer option keys. Rationale: the verified engine normalizes the numeric selection to `[String(n)]` and does one option lookup, so multiply-by-value semantics would break bit-for-bit parity of engine steps 1-2. Steppers over non-linear price curves come free. Per-`configuration.quantity` scaling remains available via `applies: PER_UNIT`. (No MVP seed row uses QUANTITY -- section 5.12.) |
| TOGGLE | `boolean` | Must be boolean (else `INVALID_SELECTION_VALUE`); `false` is equivalent to absent (engine skips `false` -- parity). Seed lint forces `isRequired: false` on TOGGLE groups, so "required toggle" cannot exist. | `true` -> ids `["true"]` -> no option match (optionless) -> group `priceDelta`, line-item kind `modifier`. (No MVP seed row uses TOGGLE -- section 5.12.) |
| TEXTAREA | never in `selections` | Presence under `selections` -> `TEXTAREA_IN_SELECTIONS`. Value flows exclusively via `configuration.description` (section 6): QUOTE requires trimmed length 10..2000 (`QUOTE_DESCRIPTION_REQUIRED` / `DESCRIPTION_TOO_LONG`); PRICED/FROM presence -> `DESCRIPTION_NOT_ALLOWED`. | Never reaches the engine. |

Cross-cutting rules:

- **Required groups:** every ACTIVE `isRequired` group of inputType SELECT/MULTISELECT/QUANTITY
  must have a key in `selections`. (TEXTAREA requiredness maps to the description rules; TOGGLE
  is never required.) PRICED/FROM payloads that carry only a description -- or nothing -- fail
  here with `MISSING_REQUIRED_GROUP` per required group (foundation-pinned behavior).
- **Unknown keys:** every `selections` key must match an ACTIVE group key of the service;
  anything else -> `UNKNOWN_SELECTION_KEY`. This includes keys of INACTIVE groups (an option or
  group retired by seed/admin stops being selectable immediately).
- **Top-level `configuration.quantity`:** integer, `1 <= quantity <= 99` (upper bound proposed
  here as an abuse guard), default 1 (P14-M2 contract default).
- **Zero-delta line items:** options with `priceDelta: 0` (frequency, pest-type) still emit $0
  line items in the verified client engine (a zero `Money` object is truthy there). The server
  port must preserve this: skip only when NO delta is defined (`null`), not when the amount is 0
  -- otherwise line-item output diverges from the published engine. Owned by
  `03-pricing-engine.md`; restated here because the seed encodes many deliberate zero deltas.

## 9. Adding service #12 with zero code (walkthrough)

Example: `gutter-cleaning` (PRICED). Two JSON edits and one command -- no TypeScript files touched,
no migration, no enum change.

Step 1 -- add the pricing entry to `prisma/seed-data/apex-pricing.v1.json` (all SAMPLE):

```json
"gutter-cleaning": {
  "mode": "PRICED",
  "base_price": { "amount": 0, "currency": "USD" },
  "modifiers": [
    {
      "id": "home-size",
      "label": "Home size",
      "type": "select",
      "applies": "flat",
      "options": [
        { "id": "single-story", "label": "Single story", "delta": { "amount": 12900, "currency": "USD" } },
        { "id": "two-story", "label": "Two story", "delta": { "amount": 17900, "currency": "USD" } }
      ]
    },
    {
      "id": "guard-install",
      "label": "Add gutter guards",
      "type": "toggle",
      "applies": "flat",
      "delta": { "amount": 8900, "currency": "USD" }
    }
  ],
  "fees": [],
  "rules": []
}
```

Step 2 -- add the catalog entry to `prisma/seed-data/apex-catalog.json` (format owned by
`02-database.md` section 6.6 -- structure and copy only, NO money/mode/rules):

```json
{
  "id": "gutter-cleaning",
  "title": "Gutter Cleaning",
  "category": "one-time",
  "pricing_ref": "gutter-cleaning",
  "summary": "Single- and two-story gutter cleanouts.",
  "badges": ["Ladder-safe pros"],
  "is_recurring_eligible": false,
  "sort_order": 11,
  "config_options": [
    {
      "id": "home-size", "label": "Home size", "input": "select",
      "required": true, "ui_hint": null,
      "choices": [
        { "id": "single-story", "label": "Single story" },
        { "id": "two-story", "label": "Two story" }
      ]
    },
    {
      "id": "guard-install", "label": "Add gutter guards", "input": "toggle",
      "required": false, "ui_hint": null,
      "choices": []
    }
  ]
}
```

Step 3 -- `npm run prisma:seed`.

What turns on automatically, with zero code: the service appears in `GET /services`;
`GET /services/gutter-cleaning/config` serves the two groups; `POST
/services/gutter-cleaning/config/price` prices `{ "selections": { "home-size": "two-story",
"guard-install": true } }` at 17900 + 8900 = 26800 cents; `POST /bookings` validates, recomputes,
snapshots, and issues an `APX-2026-NNNN` reference; the zip gate, waitlist arm, and quote/PM
machinery are untouched. Reassigning a service's mode (e.g. flipping `handyman` to QUOTE) is
likewise a seed edit -- modes are data, not code.

The same recipe with mode `"QUOTE"` uses an EMPTY pricing entry (`{ "mode": "QUOTE",
"base_price": { "amount": 0, "currency": "USD" }, "modifiers": [], "fees": [], "rules": [] }`)
plus a catalog entry whose `config_options` declares the required TEXTAREA `description` group.

## 10. When you DO need code (honesty note)

The zero-code promise covers new *combinations* of existing semantics. A genuinely new input
semantic is a code change, on purpose -- the enum is the contract that keeps validator, engine,
and frontend renderers in lockstep:

| Change | What it costs |
|---|---|
| New input semantic (date picker, free-numeric square-footage input that multiplies a per-sqft rate, address sub-form, file upload) | New `ConfigInputType` enum value -> Prisma migration; a `validateSelections` branch; an engine/table mapping decision in `03-pricing-engine.md`; a frontend renderer. The per-sqft example is the canonical trap: it looks like QUANTITY but demands multiply-by-value math, which section 8.2 deliberately excludes to preserve engine parity. |
| New rule trigger kind (e.g. zip-based surcharge, date-based seasonal pricing) | New trigger `kind` handling in the rules evaluator (pricing module) + seed lint for the new trigger shape. Trigger/effect payloads stay Json, so no migration. |
| New effect calc (e.g. tiered percent, flat-per-unit discount) | Rules evaluator change; no migration. |
| New pricing mode (e.g. SUBSCRIPTION) | New `PricingMode` enum value -> migration + one new `PricingModeHandler` registration. No switch statements to hunt down (registry dispatch is the only fork; foundation-pinned). |
| New `uiHint` value | NO code. Seed-list addition + frontend renderer when convenient; unknown hints already fall back to the default renderer (section 2.1). |
| Negative option deltas (true surcharge/credit options) | MVP seed lint pins `priceDelta >= 0` on options; lifting it is a lint change plus a pricing-audit pass, not a schema change. Discounts belong in rules until then. |

## 11. Deviation rollup for this section

Pinned foundation deviations touched here:

- Deviation: preview body `{ selections, quantity }` instead of Elevate's `{ optionIds: string[] }`
  -- justified by the P14-M2 keyed-selections contract; matrix and QUANTITY semantics cannot be a
  flat option-id list (pinned Deviation 4; endpoint owned by `05-api-and-validation.md`).
- Deviation: conditional rules (`ServicePricingRule`) and the server-side engine consuming these
  rows -- justified by threshold/percent pricing (smart-home >= 3 devices, frequency discounts)
  being inexpressible in Elevate's additive server model (pinned Deviation 2; engine owned by
  `03-pricing-engine.md`).

New, argued in this section:

- Deviation: the "ACTIVE group must have >= 1 option" serving guard is scoped to option-bearing
  input types (SELECT/MULTISELECT/QUANTITY) -- justified by the foundation-pinned optionless
  TOGGLE and TEXTAREA input types, which Elevate does not have.
- Deviation: `ConfigInputType` extends Elevate's selection types with QUANTITY, TOGGLE, TEXTAREA
  -- foundation-pinned; justified by aligning the server enum with the published client contract's
  modifier types plus QUOTE capture. (Restated here because this section defines their validation
  and seed-lint semantics.)

Field renames (`inputType`, `priceDelta`, `sublabel`, `basePrice`) are foundation-pinned model
names carried into the response contract, not new deviations introduced by this section.
