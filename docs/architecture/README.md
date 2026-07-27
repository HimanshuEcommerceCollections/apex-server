# Apex Total Home Services -- Backend Architecture

Design for the `apex-server` backend (Node.js + Express + TypeScript + Prisma + PostgreSQL),
mirroring the Elevate server architecture (`c:\work\Elevate Health & Wellness\Server`) and
consuming the published P14-M2 booking-configurator contract
(`Elevate/Client/src/lib/booking/contract.schema.ts` + `pricing/engine.ts`). The repo at
`c:\work\Apex\server` is empty; these documents are the implementation blueprint, written
backend-first so the API is ready before the frontend designs land.

## Reading order and deliverable map

| File | Deliverables | Contents |
|---|---|---|
| [01-foundations.md](01-foundations.md) | 1 | Folder tree, package.json/tsconfig/.env, app wiring, the module pattern (waitlist as the fully-listed worked example), middleware inventory, `src/shared/` and the import-direction rule |
| [02-database.md](02-database.md) | 2 | Complete ready-to-paste `prisma/schema.prisma` (13 models, 17 enums), ERD, relationship/onDelete rationale, seed strategy + seed-data file formats, id-alignment enforcement, migration notes |
| [03-pricing-engine.md](03-pricing-engine.md) | 3, 7 | The engine port (full TS listings), the conditional-rules extension, the 3-handler PricingMode registry, the 11-service plug-in table with the canonical seed registry, worked cent-exact examples |
| [04-configuration-engine.md](04-configuration-engine.md) | 4 | Input primitives (SELECT/MULTISELECT/QUANTITY/TOGGLE/TEXTAREA + uiHint), declarative configurators for all 11 services, GET /config contract, selection-validation semantics, add-service-#12 walkthrough |
| [05-api-and-validation.md](05-api-and-validation.md) | 5, 6 | The 12-endpoint reference with request/response examples (booking discriminated union as the centerpiece), complete zod listings, three-layer validation model, error-code catalog, rate limits |
| [06-pipeline-shared-roadmap.md](06-pipeline-shared-roadmap.md) | 8, 9, 10 | The booking pipeline end-to-end (transaction boundary, APX-2026-NNNN counter concurrency, idempotency), cross-brand shared components, the phased backend-first roadmap with per-phase verification |

## Ownership rules (which file wins a conflict)

Every cross-cutting fact has exactly one owning section; other files restate but never redefine:

- **Wire contract** (endpoint paths/bodies/statuses, error codes and detail shapes, casing): `05`.
  Both arms of `POST /bookings` return **200**; error codes are the catalog in 05.
- **Seed registry** (group/option/rule keys, deltas, the pricing JSON): `03` sections 7/7.1/7.2.
  Cleaning is `basePrice 0` + type deltas 9500/14500/19500; rule keys are
  `freq-weekly-discount`/`freq-biweekly-discount`/`freq-monthly-discount`/`multi-device-discount`.
- **Schema + seed-file formats** (Prisma models, apex-catalog.json / apex-pricing.v1.json /
  service-area.v1.json shapes, seed.ts): `02`. `mode`, `from_price`, and `rules[]` live in the
  PRICING file; the catalog carries structure + copy only.
- **Folder tree** (file names and homes, `src/shared/` layout): `01`.
- **Validator semantics** (selection-validation rules, the description-iff-QUOTE invariant): `04`;
  its violation codes use 05's catalog vocabulary.
- **Pipeline mechanics** (transaction boundary, reference counter, idempotent replay): `06`.

## Locked decisions (the ten-second version)

- **Money** is integer cents everywhere; `Money = { amount, currency }` on the wire.
- **Three pricing modes, zero switch statements**: every PRICED/FROM service runs the SAME ported
  engine against its own DB rows; QUOTE never runs the engine. The only dispatch is a
  `Record<PricingMode, PricingModeHandler>` registry (3 handlers).
- **Conditional rules** are the one engine extension (data, not code): `min_selected` (smart-home
  15% at exactly >= 3 devices) and `option_selected` (frequency percent discounts) produce
  standard `discount` line items in the fee slot with fee rounding. `rules: []` reproduces the
  Elevate engine byte-for-byte.
- **The server recompute is the integrity guard**: client totals are compared, never trusted;
  mismatch -> 422 `PRICE_MISMATCH` carrying the recomputed price.
- **Zip gate is never an error**: out-of-area POST /bookings returns 200
  `{ outcome: "WAITLISTED", waitlist_signup }` and writes the waitlist record; in-area returns
  200 `{ outcome: "BOOKED", reference: "APX-2026-NNNN", ... }`.
- **QUOTE invariant is structural**: `BookingConfiguration.priceTotal` is NULL for QUOTE and
  `configuration.description` is required (min 10 chars) -- and rejected on PRICED/FROM.
- **References** come from a `BookingReferenceCounter` row lock inside the booking transaction;
  `request_id` -> `Booking.clientRequestId @unique` gives idempotent 200 replay on double submit.
- **No customer accounts, no payments, no real notifications** (PRD out-of-scope); all endpoints
  public + rate-limited; forms write records plus a `FormSubmissionLog` demo-inbox entry.
- **id-alignment contract**: config group/option keys equal pricing modifier/option ids VERBATIM
  (never slugged); the seed hard-fails on any mismatch before writing.

## Deviations from Elevate (all justified inline where they occur)

1. Counter-backed `APX-YYYY-NNNN` references (Elevate: random `BK-{time36}-{hex}`) -- PRD format.
2. The rich pricing engine ported server-side + the conditional-rules layer (Elevate's server
   does additive `base + sum(optionModifier)`) -- matrix/percent/threshold pricing is
   inexpressible additively, and the recompute is the integrity guard.
3. Anonymous public booking + form endpoints (Elevate authenticates `/bookings`) -- no customer
   accounts in scope; per-route rate limiters replace the auth abuse-guard.
4. Preview body `{ selections, quantity? }` (Elevate: `{ optionIds }`) -- P14-M2 keyed-selections
   contract.
   Plus section-local ones, each tagged "Deviation:" in place (200-both-arms booking status,
   idempotent waitlist duplicates, `VALIDATION_FAILED` details wrapper, ApiError factories taking
   `details?`, RATE_LIMIT_MAX 300, `src/shared/`, vitest).

## Open questions for the product owner (consolidated)

Pricing values marked SAMPLE (frequency percents, junk/pest/smart-home/power-washing/handyman
cents, FROM bands) need sign-off before launch -- all seed-data-only changes. Per-section lists
sit at the bottom of each file; the recurring themes: confirm the pool monthly-multiplier ->
percent-rule interpretation, the pro-acknowledgement must-all-be-true rule, address redaction on
booking re-read, and the deploy target for `scripts/postinstall.js`.

## Provenance

Designed against verified ground truth: the Elevate server source and its
`service-configuration-model.md`, the published contract/engine files in the Elevate client, and
the already-built Apex frontend data (`client/src/data/**` -- cleaning matrix and lawn tiers are
frontend-verified numbers). Drafted by six parallel design agents against a pinned foundation
spec, adversarially reviewed by four independent verifiers (PRD compliance, Elevate parity,
cross-section consistency, technical correctness), and reconciled finding-by-finding.
