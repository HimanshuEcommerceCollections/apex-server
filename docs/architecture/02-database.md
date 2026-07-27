# Database design: complete Prisma schema

This section delivers DELIVERABLE 2: the complete, ready-to-paste `prisma/schema.prisma`
for the Apex server, the entity-relationship picture, every FK/onDelete decision with its
reasoning, the seed strategy (including the id-alignment contract enforcement), and the
migration conventions.

Read together with:

- `foundation-spec.md` (pinned model/enum/endpoint names; the four approved deviations) -
  every pinned name below is used verbatim; fields the foundation left open are marked
  "author decision".
- `elevate-conventions.md` (verified Elevate server conventions; ground truth for
  "mirror Elevate").
- `01-foundations.md` (where `prisma/`, `src/enums/`, `src/db/` live).
- `03-pricing-engine.md` (the engine port and the `ServicePricingRule` trigger/effect JSON shapes
  this schema stores).

Conventions inherited from Elevate (`Server/prisma/schema.prisma`):

- Money is stored in INTEGER MINOR units (cents). No floats, no decimals, ever.
- All ids are UUID strings (`@default(uuid())`).
- All tables carry `createdAt`/`updatedAt`, except append-only snapshot/log tables
  (`BookingConfiguration`, `FormSubmissionLog`), which follow the Elevate `UserDetails` /
  `WebhookEvent` precedent and carry `createdAt` only.
- Prisma owns all enums; the app re-exports them via `src/enums/index.ts` (section 9).
- Additive-safe defaults on every column that could ever be added to a populated table.

## 1. Decision table

| # | Decision | Choice | Why |
|---|---|---|---|
| 1 | Keep `FormSubmissionLog`? | KEEP (author decision) | PRD: "forms are stubs -> records + demo inbox". The five typed tables are the records of truth; the log gives (a) one chronological demo-inbox feed across all form kinds without a 5-way UNION, (b) the exact validated wire payload for debugging stub flows. Mirrors Elevate's append-only `WebhookEvent` style (no `updatedAt`). Cost: one append per POST, no reads on the hot path. |
| 2 | Category status enum | New `CategoryStatus { ACTIVE COMING_SOON INACTIVE }` (author decision) | Mirrors Elevate, which has a distinct `CategoryStatus` enum (its `add_coming_soon_category_status` migration proves the member set). Reusing `ServiceStatus` would leak `DRAFT` semantics categories do not need; enum members are additive later if they do. |
| 3 | Cleaning base anchor | `Service.basePrice = 0` + full-price cleaning-type deltas `9500 / 14500 / 19500` (author decision; foundation offered two options) | Generalized: EVERY MVP service seeds `basePrice 0` with absolute option deltas, so the pattern is uniform ("one SELECT carries the price"), no cleaning type is silently privileged as "the" base, and the seed reads like the marketing sheet ($95/$145/$195). Matrix stays exact at every combination: `0 + typeDelta + beds*2500 + baths*1500`, then the frequency percent rule. The engine's `base * quantity` step contributes 0 and still emits a $0.00 "Base" line item (unconditional emission is Elevate port fidelity - see `03-pricing-engine.md`; hiding zero lines is a frontend rendering choice). The alternative (base 9500 + deltas 0/5000/10000) yields identical totals but makes Deep/Move read as surcharges and turns reassigning the cheapest type into a two-place edit; the QUOTE signal is `pricingMode`, never `basePrice`. |
| 4 | `pricingMode` default | NO default; seed must set it explicitly (author decision) | The mode split (6 PRICED / 2 FROM / 3 QUOTE) is acceptance-load-bearing. A silent default could misclassify a QUOTE service and violate the "QUOTE omits displayed_price" invariant. Reassignment stays a seed-data change, never a code change. |
| 5 | Booking contract-parity extras | Add `contactPreferredMethod ContactMethod @default(EMAIL)`, `consentMarketing Boolean @default(false)`, `schedulePreferences Json?`, `clientRequestId String? @unique` (author decisions) | The P14-M2 `booking_request` contract carries `contact.preferred_method`, `contact.consent_marketing`, `schedule_preferences`, and `request_id`. All four are additive-safe (defaulted or nullable). `clientRequestId @unique` absorbs double-submits idempotently (same spirit as the waitlist `@@unique([email, zip])`). |
| 6 | `location_pref` | NOT persisted as columns | Every Apex trade is onsite at the service address; the address columns ARE the Apex extension replacing `location_pref`. The wire field is validated then discarded (see `05-api-and-validation.md` / `05-api-and-validation.md`). |
| 7 | `ConfigInputType` vs Elevate's live `ConfigSelectionType` | Use pinned `ConfigInputType { SELECT MULTISELECT QUANTITY TOGGLE TEXTAREA }` | Pinned by foundation-spec section 2. This follows Elevate's own forward design (`Server/docs/service-configuration-model.md` proposes `ConfigInputType`) rather than its live two-value `ConfigSelectionType`; Apex needs `TEXTAREA` for QUOTE descriptions. Part of the pinned config-model extension, not a free deviation. |
| 8 | Quantity bounds on groups | Add `quantityMin/quantityMax/quantityStep Int?` (author decision) | Elevate's config-model doc models them for `QUANTITY` groups; no MVP seed data uses `QUANTITY`, but three nullable columns are additive-safe and avoid a migration when the first quantity group (e.g. window count) lands. |
| 9 | `ServicePricingRule.status` enum | Reuse `ConfigStatus { ACTIVE INACTIVE }` | Rules share the config lifecycle (seed-owned, toggleable). A dedicated enum would duplicate `ConfigStatus` exactly. |
| 10 | Where `mode` lives in seed data | `apex-pricing.v1.json` per-service entry (author decision) | Pricing mode governs engine behavior, so it sits next to `base_price`/`modifiers`/`rules` in the pricing file. The catalog file stays pure structure + copy. |
| 11 | `WaitlistSignup.zip` FK to `ServiceAreaZip`? | NO FK, plain string | A waitlist row exists precisely because the zip is NOT in (or not active in) the allowlist. An FK would make the whole feature impossible. |
| 12 | `ProApplication.trades` FK? | NO FK, `String[]` of service slugs | Applications may cite trades before/without catalog rows; validated against `Service.slug` at the business layer. |
| 13 | `BookingConfiguration` as a 1:1 table vs Json column on Booking | Separate 1:1 table (pinned by foundation-spec) | Mirrors Elevate's `UserDetails` 1:1-snapshot pattern; keeps the QUOTE null-price invariant (`priceTotal Int?`) expressible as a column, not a Json convention. |
| 14 | Seed resync strategy for config rows | delete-and-recreate per service (Elevate seed precedent) | Safe because NOTHING FKs config rows: bookings snapshot `selections` as Json (keys, not ids). Idempotent reruns always converge on the source files. |
| 15 | `ServiceAreaZip` removals | Seed deactivates (`active=false`), never deletes | Waitlist/booking history keeps meaning; the allowlist check reads `active=true` only. |

Deviations from Elevate touched by this section (all four are pinned in foundation-spec
section 8; no additional deviations are introduced):

- Deviation: `BookingReferenceCounter` + `APX-YYYY-NNNN` sequential references instead of
  Elevate's random `BK-{time36}-{hex}` - justified by the PRD-mandated reference format;
  sequential numbering requires a collision-safe counter row per brand-year.
- Deviation: `ServicePricingRule` table + full price snapshot columns
  (`priceSubtotal`/`lineItems`/`pricingVersion`) on `BookingConfiguration` - justified by
  the server-side engine port (Elevate keeps the rich engine client-side and stores only
  `priceAmount` + a lineItems Json); matrix/percent/threshold pricing cannot be expressed
  as Elevate's additive "base + sum(optionModifier)".
- Deviation: `Booking` has NO `customerId`/`User` relation; contact is snapshotted
  per-booking - justified by the PRD (customer accounts out of scope; `POST /bookings` is
  public). Elevate's `User`/`RefreshToken`/auth tables are NOT ported in MVP; the auth
  middleware scaffold ships without tables until the post-MVP admin surface needs them.
- Deviation: preview body `{ selections, quantity }` instead of `{ optionIds }` - a DB
  consequence only in that `BookingConfiguration.selections` stores the keyed
  `Record<group.key, value>` shape, not an option-id array (see section 6).

## 2. Complete prisma/schema.prisma

The file below is complete and valid - paste it as `server/prisma/schema.prisma`.
Index and onDelete justifications are inline comments so they survive into the repo.

```prisma
// Prisma schema for the Apex Total Home Services booking platform.
// Mirrors the Elevate server conventions (see docs/architecture/02-database.md):
//   - Money is stored in INTEGER MINOR units (cents) to avoid float drift.
//   - All ids are UUID strings. All tables carry createdAt/updatedAt, except
//     append-only snapshot/log tables (BookingConfiguration, FormSubmissionLog),
//     which follow Elevate's UserDetails/WebhookEvent precedent (createdAt only).
//   - Enums live here as the single source of truth and are re-exported to the
//     app via src/enums (which imports them from @prisma/client).

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ---------------------------------------------------------------------------
// Enums (pinned set from the foundation spec + three author additions:
// CategoryStatus, ContactMethod, FormKind)
// ---------------------------------------------------------------------------

// Single-brand DB; the column exists so cross-brand reuse (waitlist, bookings)
// is a seed/enum change, not a schema rewrite.
enum Brand {
  APEX
}

// How a service prices in the Core Flow. Modes are DATA: reassigning a service
// (e.g. handyman FROM -> PRICED) is a seed change, never code.
enum PricingMode {
  PRICED // live engine total at Step 3
  FROM   // engine runs; UI frames it as a "From $X" band ("final pricing confirmed by your pro")
  QUOTE  // NO engine run; description textarea; displayed_price omitted end-to-end
}

enum ServiceStatus {
  DRAFT
  ACTIVE
  COMING_SOON
  INACTIVE
}

// Author decision: distinct from ServiceStatus, mirroring Elevate's separate
// CategoryStatus enum. Members are additive later if needed.
enum CategoryStatus {
  ACTIVE
  COMING_SOON
  INACTIVE
}

// The five configurator input kinds. SELECT/MULTISELECT carry options[];
// QUANTITY/TOGGLE are optionless (group-level priceDelta); TEXTAREA is the
// QUOTE description input (no pricing counterpart at all).
enum ConfigInputType {
  SELECT
  MULTISELECT
  QUANTITY
  TOGGLE
  TEXTAREA
}

// Mirrors pricing Modifier.applies; PER_UNIT scales the delta by
// Configuration.quantity in the engine (bit-for-bit Elevate parity).
enum ConfigApplies {
  FLAT
  PER_UNIT
}

enum ConfigStatus {
  ACTIVE
  INACTIVE
}

enum BookingStatus {
  DRAFT
  PENDING
  CONFIRMED
  IN_PROGRESS
  COMPLETED
  CANCELLED
}

enum BookingSource {
  WEB
  API
}

// Author decision: mirrors the P14-M2 contact.preferred_method wire values
// (email | phone | sms), SCREAMING_SNAKE per Prisma enum convention.
enum ContactMethod {
  EMAIL
  PHONE
  SMS
}

enum QuoteStatus {
  NEW
  REVIEWING
  SENT
  WON
  LOST
}

enum QuoteSource {
  BOOKING_FLOW
  PM_FORM
}

enum PMBundle {
  TURNOVER
  LISTING_PREP
}

enum WaitlistSource {
  SERVICE_AREA_MISS
  SERVICE_AREA_PAGE
}

enum WaitlistStatus {
  ACTIVE
  NOTIFIED
  CONVERTED
}

enum ProApplicationStatus {
  RECEIVED
  REVIEWING
  CONTACTED
}

// Author decision: discriminator for the FormSubmissionLog demo-inbox feed.
enum FormKind {
  BOOKING
  QUOTE
  PM_REQUEST
  PRO_APPLICATION
  WAITLIST
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

/// Groups the 11 trades (e.g. recurring-core / one-time / specialty).
/// The grouping itself is seed data, not code.
model ServiceCategory {
  id          String         @id @default(uuid())
  name        String         @unique
  slug        String         @unique
  description String?
  sortOrder   Int            @default(0)
  status      CategoryStatus @default(ACTIVE)
  createdAt   DateTime       @default(now())
  updatedAt   DateTime       @updatedAt

  services Service[]

  // The /services page reads "active categories in display order" - tiny
  // table, but the composite keeps that one read on an index.
  @@index([status, sortOrder])
}

/// One of the 11 trades. `pricingRef` (not `slug`) resolves the id-alignment
/// contract into apex-pricing.v1.json; the two are equal in the MVP seed but
/// are separate columns because Elevate proved they can diverge.
model Service {
  id                  String        @id @default(uuid())
  categoryId          String
  name                String        @unique
  slug                String        @unique // PRD slugs verbatim: "cleaning", "lawn-care", ...
  summary             String?
  description         String?
  pricingMode         PricingMode // NO default: mode is acceptance-load-bearing; seed sets it explicitly
  pricingRef          String // key into apex-pricing.v1.json services{}
  basePrice           Int // cents; the ENGINE base (base_price.amount). 0 for every MVP service (prices live in option deltas - decision #3); QUOTE services never run the engine at all.
  fromPrice           Int? // cents; DISPLAY-ONLY "From $X" band (FROM mode). Never summed into the recompute.
  currency            String        @default("USD")
  status              ServiceStatus @default(DRAFT)
  badges              String[]      @default([])
  sortOrder           Int           @default(0)
  claimsBlock         String? // NC license/claims copy (pest-control, home-security, tree-stump)
  isRecurringEligible Boolean       @default(false) // cleaning/lawn-care/pool/pest-control plan callouts
  createdAt           DateTime      @default(now())
  updatedAt           DateTime      @updatedAt

  // Restrict: a category with services cannot be hard-deleted (retire via status).
  category       ServiceCategory        @relation(fields: [categoryId], references: [id], onDelete: Restrict)
  configGroups   ServiceConfigGroup[]
  pricingRules   ServicePricingRule[]
  bookings       Booking[]
  configurations BookingConfiguration[]
  quoteRequests  QuoteRequest[]

  // Catalog list reads filter by category and render in sortOrder; status
  // filter backs GET /services?status=ACTIVE.
  @@index([categoryId, sortOrder])
  @@index([status])
}

/// A configurable dimension of a service (Cleaning type, Bedrooms, Devices...).
/// ID-ALIGNMENT CONTRACT: `key` equals the pricing modifier id within
/// apex-pricing.v1.json services[service.pricingRef].modifiers[] - carried
/// VERBATIM from the source, NEVER slugged from the label. TEXTAREA groups
/// (QUOTE description) are the one exception: they have no pricing counterpart.
model ServiceConfigGroup {
  id           String          @id @default(uuid())
  serviceId    String
  key          String // == modifiers[].id under service.pricingRef (verbatim)
  label        String
  inputType    ConfigInputType
  uiHint       String? // presentation only: "matrix-axis" | "load-estimator" | "device-checklist" | "frequency" | null. NEVER read by the pricing engine.
  applies      ConfigApplies   @default(FLAT) // PER_UNIT scales the delta by quantity (engine parity)
  isRequired   Boolean         @default(false)
  sortOrder    Int             @default(0)
  status       ConfigStatus    @default(ACTIVE)
  priceDelta   Int? // cents; group-level fallback (engine "option.delta ?? modifier.delta") for optionless QUANTITY/TOGGLE groups. NULL for SELECT/MULTISELECT/TEXTAREA.
  selectMin    Int? // MULTISELECT selection-count bounds; NULL = unbounded
  selectMax    Int?
  quantityMin  Int? // QUANTITY numeric bounds (author decision: Elevate parity; unused by the MVP seed)
  quantityMax  Int?
  quantityStep Int?
  createdAt    DateTime        @default(now())
  updatedAt    DateTime        @updatedAt

  // Cascade: config is wholly owned by its service. Safe because NOTHING FKs
  // config rows - bookings snapshot selections as Json keys, and
  // Booking.serviceId is Restrict, so a booked service can never be deleted;
  // the cascade only ever fires for never-booked/draft services.
  service Service               @relation(fields: [serviceId], references: [id], onDelete: Cascade)
  options ServiceConfigOption[]

  @@unique([serviceId, key]) // id-alignment: a group key is unique within its service
  @@index([serviceId, sortOrder]) // ordered fetch for GET /services/:idOrSlug/config
}

/// A choice within a group (Deep Clean, 3 bedrooms, xlarge yard...).
/// `key` equals the pricing modifier OPTION id under service.pricingRef -
/// verbatim, never slugged. `priceDelta` is added by the engine when selected.
model ServiceConfigOption {
  id         String       @id @default(uuid())
  groupId    String
  key        String // == modifiers[].options[].id under service.pricingRef (verbatim)
  label      String
  sublabel   String? // secondary display line, e.g. "Up to 1/4 acre", "15,000-25,000 gal"
  priceDelta Int          @default(0) // cents; >= 0 in MVP (zod-enforced; NO DB check constraint - the booking-creation recompute is the integrity guard)
  sortOrder  Int          @default(0)
  status     ConfigStatus @default(ACTIVE)
  createdAt  DateTime     @default(now())
  updatedAt  DateTime     @updatedAt

  // Cascade: an option cannot outlive its group (same ownership argument as above).
  group ServiceConfigGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)

  @@unique([groupId, key]) // id-alignment: an option key is unique within its group
  @@index([groupId, sortOrder]) // ordered fetch for the configurator payload
}

/// THE APEX EXTENSION over the Elevate config model: a declarative conditional
/// rule evaluated in the engine's fee slot (see 03-pricing-engine.md). Produces
/// standard "discount"/"fee" LineItems; percent effects compute against the
/// running subtotal with fee rounding: Math.round(subtotal * value / 100).
/// trigger (MVP kinds):
///   { "kind": "min_selected",    "group": "devices",   "count": 3 }
///   { "kind": "option_selected", "group": "frequency", "option": "weekly" }
/// effect:
///   { "kind": "discount" | "fee", "calc": "percent" | "flat", "value": 15 }
model ServicePricingRule {
  id        String       @id @default(uuid())
  serviceId String
  key       String // stable rule id (analytics + LineItem identity), e.g. "freq-weekly-discount", "multi-device-discount"
  label     String // customer-facing line-item label, e.g. "Weekly plan discount"
  trigger   Json
  effect    Json
  sortOrder Int          @default(0) // rules evaluate deterministically in sortOrder
  status    ConfigStatus @default(ACTIVE)
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt

  // Cascade: rules are catalog config, wholly owned by the service (same
  // safety argument as ServiceConfigGroup).
  service Service @relation(fields: [serviceId], references: [id], onDelete: Cascade)

  @@unique([serviceId, key]) // a rule key is unique within its service
  @@index([serviceId, sortOrder])
}

// ---------------------------------------------------------------------------
// Booking (the Core Flow)
// ---------------------------------------------------------------------------

/// A Core Flow submission. Anonymous by design (no customer accounts in MVP -
/// pinned deviation 3): contact and address are per-booking snapshots.
model Booking {
  id              String        @id @default(uuid())
  reference       String        @unique // APX-YYYY-NNNN via BookingReferenceCounter (pinned deviation 1)
  clientRequestId String?       @unique // wire request_id (uuid); absorbs double-submits idempotently (author decision)
  serviceId       String
  status          BookingStatus @default(PENDING)
  quoteRequest    Boolean       @default(false) // DERIVED server-side from service.pricingMode == QUOTE; client value ignored
  brand           Brand         @default(APEX)
  source          BookingSource @default(WEB)

  // Contact snapshot (the Details step)
  contactName            String
  contactEmail           String
  contactPhone           String?
  contactPreferredMethod ContactMethod @default(EMAIL) // author decision: contract parity
  consentMarketing       Boolean       @default(false) // author decision: contract parity

  // Address snapshot - the Apex extension over the base booking_request.
  // addressZip is validated against ServiceAreaZip at the business layer and
  // is deliberately NOT an FK: it is a historical snapshot that must keep its
  // value even if the allowlist changes.
  addressStreet String
  addressCity   String
  addressState  String @default("NC")
  addressZip    String // 5-digit

  notes               String?
  schedulePreferences Json? // author decision: wire-contract parity; no scheduling UI in MVP

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Restrict: booking history must survive catalog edits. A service with
  // bookings can NEVER be hard-deleted - it is retired via status. This is
  // what makes the config-table Cascades above safe.
  service       Service               @relation(fields: [serviceId], references: [id], onDelete: Restrict)
  configuration BookingConfiguration?
  quote         QuoteRequest?

  @@index([serviceId])
  @@index([status])
  @@index([contactEmail]) // GET /bookings/:reference verifies reference + email; demo-inbox lookups by requester
  @@index([createdAt]) // demo inbox reads newest-first
}

/// Immutable snapshot of the Configure + Price steps (1:1 with Booking).
/// Never updated after creation - Elevate UserDetails precedent, so
/// createdAt only. priceTotal is NULL for QUOTE bookings: the
/// "QUOTE omits displayed_price" invariant, enforced at the data layer.
model BookingConfiguration {
  id             String   @id @default(uuid())
  bookingId      String   @unique
  serviceId      String // denormalized copy of Booking.serviceId for direct snapshot-vs-catalog queries
  selections     Json // Record<group.key, string | number | boolean | string[]>; values are option KEYS, verbatim (pinned deviation 4 shape)
  quantity       Int      @default(1)
  description    String? // QUOTE free text ONLY (configuration.description); PRICED/FROM submissions carrying it are rejected 422 DESCRIPTION_NOT_ALLOWED - free text goes in Booking.notes (see 04-configuration-engine.md)
  priceTotal     Int? // cents; recomputed server-side. NULL for QUOTE - never 0.
  priceSubtotal  Int? // cents; pre-rule/pre-fee subtotal (base*quantity + modifier deltas)
  lineItems      Json? // LineItem[] snapshot: { label, amount: { amount, currency }, kind: base|modifier|option|fee|discount }. NULL for QUOTE.
  pricingVersion String? // e.g. "apex-pricing.v1" - which pricing table priced this booking. NULL for QUOTE.
  currency       String   @default("USD")
  isEstimate     Boolean  @default(true) // MVP: always true (stub flow; coordinator confirms)
  createdAt      DateTime @default(now())

  // Cascade: the snapshot is owned by (and meaningless without) its booking.
  booking Booking @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  // Restrict: belt-and-braces with Booking.serviceId - the snapshot pins the
  // catalog row it was priced against.
  service Service @relation(fields: [serviceId], references: [id], onDelete: Restrict)

  @@index([serviceId]) // "all cleaning configurations" reporting reads
}

// ---------------------------------------------------------------------------
// Quotes and B2B
// ---------------------------------------------------------------------------

/// A quote_request record. Created by the booking pipeline for QUOTE-mode
/// bookings (source BOOKING_FLOW) or by the PM form (source PM_FORM, no
/// booking). Contact fields are DENORMALIZED so a quote stands alone if its
/// booking or service pointer goes away - which is why both FKs are SetNull.
model QuoteRequest {
  id           String      @id @default(uuid())
  bookingId    String?     @unique // 1:1 from QUOTE bookings; NULL for PM_FORM quotes
  serviceId    String? // NULL for PM quotes that span trades
  description  String
  status       QuoteStatus @default(NEW)
  source       QuoteSource
  contactName  String
  contactEmail String
  contactPhone String?
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt

  // SetNull (both): the quote is the coordinator's work item; it must survive
  // deletion of the booking (admin cleanup) or the service (catalog pruning).
  booking   Booking?   @relation(fields: [bookingId], references: [id], onDelete: SetNull)
  service   Service?   @relation(fields: [serviceId], references: [id], onDelete: SetNull)
  pmRequest PMRequest?

  @@index([status]) // coordinator queue: NEW first
  @@index([source, createdAt]) // demo inbox: newest per source
}

/// pm_request EXTENDS quote_request (PRD contract): the B2B-only fields live
/// on a 1:1 extension row. Lifecycle status stays on the parent QuoteRequest.
model PMRequest {
  id             String   @id @default(uuid())
  quoteRequestId String   @unique
  company        String?
  unitsEst       Int
  bundle         PMBundle
  scopeNotes     String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  // Cascade: the extension row is meaningless without its parent quote.
  quoteRequest QuoteRequest @relation(fields: [quoteRequestId], references: [id], onDelete: Cascade)
}

// ---------------------------------------------------------------------------
// Waitlist, pros, service area
// ---------------------------------------------------------------------------

/// waitlist_signup: zip-miss capture (never a dead end) + /service-area page
/// signups. id doubles as the wire signup_id.
model WaitlistSignup {
  id        String         @id @default(uuid())
  brand     Brand          @default(APEX)
  email     String
  zip       String // the MISSED zip - deliberately NOT an FK to ServiceAreaZip (the row exists precisely because the zip is absent or inactive there)
  source    WaitlistSource
  status    WaitlistStatus @default(ACTIVE)
  createdAt DateTime       @default(now())
  updatedAt DateTime       @updatedAt

  @@unique([email, zip]) // idempotency: double-submits land on the same row (P2002 handled as success by the waitlist service)
  @@index([zip]) // "notify everyone waiting on 27540" when the area expands
  @@index([status])
}

/// Become-an-Apex-Pro application. Acknowledgements are collected expectations
/// (pest = NC license; security = NC alarm license; cleaning = own supplies)
/// and are NEVER verified (PRD).
model ProApplication {
  id               String               @id @default(uuid())
  name             String
  email            String
  phone            String?
  zip              String
  trades           String[] // service slugs (multi-select); validated against Service.slug at the business layer, not FK'd
  acknowledgements Json // Record<tradeSlug, Record<ackKey, boolean>> as collected
  status           ProApplicationStatus @default(RECEIVED)
  notes            String?
  createdAt        DateTime             @default(now())
  updatedAt        DateTime             @updatedAt

  @@index([email]) // review-time dedupe; reapplication is allowed, so email is NOT unique
  @@index([status])
}

/// THE shared Raleigh zip allowlist. Apex OWNS the source file
/// (prisma/seed-data/service-area.v1.json); future Raleigh brands consume the
/// same file. Rows are deactivated, never deleted, so history keeps meaning.
model ServiceAreaZip {
  id        String   @id @default(uuid())
  zip       String   @unique // 5-digit
  county    String   @default("Wake")
  city      String?
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // No index beyond zip @unique: the table is Wake-County small and is read
  // either whole (allowlist load, /service-area page) or by unique zip.
}

/// Pinned deviation 1 support: collision-safe sequential booking references
/// APX-YYYY-NNNN. One row per (brandCode, year); the generator increments the
/// row inside the booking $transaction - Postgres row locking serializes
/// concurrent increments, so two bookings can never mint the same number.
model BookingReferenceCounter {
  id        String   @id @default(uuid())
  brandCode String // "APX"; parameterized so future brands reuse the generator
  year      Int // 2026 -> "APX-2026-NNNN"
  counter   Int      @default(0) // last issued sequence; next = counter + 1, zero-padded to >= 4 digits
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([brandCode, year]) // exactly one counter per brand-year (the atomic-increment target)
}

/// KEPT (author decision, see decision table #1): append-only raw-payload
/// audit behind the demo inbox. Typed tables remain the records of truth.
/// Append-only log => no updatedAt (Elevate WebhookEvent precedent).
model FormSubmissionLog {
  id        String   @id @default(uuid())
  kind      FormKind
  payload   Json // the validated request body, as received
  entityId  String? // id of the created row (Booking/QuoteRequest/...); polymorphic by design - no FK
  createdAt DateTime @default(now())

  @@index([kind, createdAt]) // demo inbox: filter by form type, newest first
}
```

## 3. Entity-relationship diagram (ASCII)

```
                              CATALOG (seed-owned)
 +-----------------+ 1     * +---------------------+ 1     * +----------------------+
 | ServiceCategory |---------|       Service       |---------|  ServiceConfigGroup  |
 | slug  @unique   |Restrict | slug/name @unique   | Cascade | @@uniq(serviceId,key)|
 +-----------------+         | pricingMode/Ref     |         +----------+-----------+
                             | basePrice (cents)   |                    | 1
                             +--+-------+-------+--+                    | Cascade
                                |       |       |                       | *
                        Cascade |       |       |            +----------+-----------+
                              * |       |       |            | ServiceConfigOption  |
                +---------------+--+    |       |            | @@uniq(groupId,key)  |
                | ServicePricingRule|   |       |            | priceDelta (cents)   |
                | @@uniq(svcId,key) |   |       |            +----------------------+
                | trigger/effect Json|  |       |
                +-------------------+   |       |
                                        |       |
        BOOKING (request-owned)         |       |
                             Restrict * |       | * Restrict         SetNull * (serviceId?)
 +--------------------------+   +-------+-----+ |  +--------------------------------+
 | BookingConfiguration     |1:1|   Booking   |-+  |          QuoteRequest          |
 | bookingId @unique        |   | reference   |    | bookingId? @unique   (SetNull) |
 | selections Json snapshot |<--| @unique     |--->| contact denormalized           |
 | priceTotal Int? (QUOTE=  |Csc| APX-YYYY-   |0..1| source BOOKING_FLOW | PM_FORM  |
 |   NULL)                  |   |   NNNN      |    +---------------+----------------+
 +--------------------------+   | contact +   |                    | 1
   (also serviceId -> Service,  | address     |            Cascade | 0..1
    Restrict)                   | snapshot    |    +----------------+---------------+
                                +-------------+    | PMRequest                      |
                                                   | quoteRequestId @unique         |
                                                   | unitsEst, bundle, scopeNotes   |
                                                   +--------------------------------+

        STANDALONE (no FKs anywhere - by design)
 +----------------+  +----------------+  +----------------+  +-------------------------+  +-------------------+
 | WaitlistSignup |  | ProApplication |  | ServiceAreaZip |  | BookingReferenceCounter |  | FormSubmissionLog |
 | @@uniq(email,  |  | trades String[]|  | zip @unique    |  | @@uniq(brandCode,year)  |  | kind + payload    |
 |   zip)         |  |                |  | active flag    |  | counter (atomic incr)   |  | append-only       |
 +----------------+  +----------------+  +----------------+  +-------------------------+  +-------------------+
```

Legend: `1 --- *` one-to-many; `1:1` via `@unique` FK; `0..1` optional one-to-one.
The onDelete behavior is printed on each edge (Restrict / Cascade / SetNull).

## 4. Relationships table

| FK (child -> parent) | Cardinality | onDelete | Why this behavior |
|---|---|---|---|
| `Service.categoryId -> ServiceCategory.id` | N:1, required | Restrict | A category with services cannot be hard-deleted; retire via `status`. Catalog integrity over convenience. |
| `ServiceConfigGroup.serviceId -> Service.id` | N:1, required | Cascade | Config is wholly owned by its service (Elevate parity). Safe: nothing FKs config rows - `BookingConfiguration.selections` snapshots KEYS as Json, not ids - and `Booking.serviceId` Restrict means a booked service can never be deleted, so the cascade only fires for never-booked/draft services. |
| `ServiceConfigOption.groupId -> ServiceConfigGroup.id` | N:1, required | Cascade | Same ownership argument, one level down. |
| `ServicePricingRule.serviceId -> Service.id` | N:1, required | Cascade | Rules are catalog config like groups; same safety argument. Booked rule outcomes survive in the `lineItems` snapshot. |
| `Booking.serviceId -> Service.id` | N:1, required | Restrict | THE snapshot-survival anchor: booking history must survive catalog edits, so a service with bookings is undeletable (retired via `ServiceStatus.INACTIVE`). This single Restrict is what makes every catalog Cascade above safe. |
| `BookingConfiguration.bookingId -> Booking.id` | 1:1 (`@unique`), required | Cascade | The snapshot is owned by its booking and meaningless without it; deleting a booking (admin cleanup) removes its snapshot atomically. Mirrors Elevate `UserDetails`. |
| `BookingConfiguration.serviceId -> Service.id` | N:1, required | Restrict | Denormalized pin to the catalog row the snapshot was priced against; Restrict is belt-and-braces with `Booking.serviceId`. |
| `QuoteRequest.bookingId -> Booking.id` | 0..1:1 (`@unique`), optional | SetNull | The quote is the coordinator's standalone work item; contact is denormalized onto it precisely so it survives booking deletion. |
| `QuoteRequest.serviceId -> Service.id` | N:0..1, optional | SetNull | Same survival argument against catalog pruning; PM quotes may have no service at all. |
| `PMRequest.quoteRequestId -> QuoteRequest.id` | 1:1 (`@unique`), required | Cascade | "pm_request extends quote_request" - the extension row has no meaning without its parent. |
| `WaitlistSignup.zip` | none (string) | n/a | Deliberately NOT an FK to `ServiceAreaZip`: the row exists because the zip is NOT in the allowlist. |
| `Booking.addressZip` | none (string) | n/a | Historical snapshot; validated against the allowlist at the business layer, then frozen. |
| `ProApplication.trades[]` | none (string array) | n/a | Slugs validated at the business layer; applications may cite trades independent of catalog lifecycle. |
| `FormSubmissionLog.entityId` | none (string) | n/a | Polymorphic pointer across five tables; an FK is impossible and the log must outlive its entity anyway. |

## 5. Non-obvious field notes

Only decisions that are easy to get wrong are listed; everything else follows directly
from the foundation spec or Elevate parity.

- `BookingConfiguration.priceTotal Int?` - NULL (never 0) for QUOTE bookings. This is the
  "QUOTE omits displayed_price" invariant pushed down to the data layer: the serializer
  omits `displayed_price` whenever `priceTotal IS NULL`, and the pipeline writes NULL if
  and only if `service.pricingMode == QUOTE`. Prisma cannot express the cross-table CHECK
  (`quoteRequest => priceTotal IS NULL` spans Booking and BookingConfiguration), so the
  invariant is transaction-enforced in the booking pipeline (see `06-pipeline-shared-roadmap.md`)
  and asserted in tests. `priceSubtotal`, `lineItems`, `pricingVersion` are NULL under
  exactly the same condition. FROM bookings DO carry a total (the engine runs; the band
  framing is presentation).
- `Booking.quoteRequest Boolean` - derived server-side from `service.pricingMode`; any
  client-sent value is ignored (validation layer note). It exists as a column (not just a
  join) because the wire contract names it and the demo inbox filters on it.
- `Booking.addressState @default("NC")` - the PRD contract fixes `state: "NC"`; the
  default makes the column self-documenting and lets validation accept-and-normalize
  rather than require the client to send it.
- `Booking.clientRequestId String? @unique` (author decision) - the wire `request_id`
  (client-generated uuid). A retry/double-submit with the same `request_id` hits the
  unique index; the pipeline catches P2002 and returns the original booking instead of
  minting a duplicate reference. Nullable so `API`-source submissions without it still work.
- `Booking.reference` - format `APX-YYYY-NNNN`. `YYYY` is the creation year of the counter
  row; `NNNN` is `String(counter).padStart(4, "0")`, which naturally widens to 5+ digits
  past 9999 (PRD says "NNNN = zero-padded 4+"). Generation pattern (inside the booking
  `$transaction`):

  ```ts
  const year = new Date().getFullYear();
  const row = await tx.bookingReferenceCounter.upsert({
    where: { brandCode_year: { brandCode: "APX", year } },
    create: { brandCode: "APX", year, counter: 1 },
    update: { counter: { increment: 1 } },
  });
  const reference = `APX-${year}-${String(row.counter).padStart(4, "0")}`;
  ```

  The `update` arm's `increment` is a single-row atomic UPDATE under a Postgres row lock,
  so concurrent bookings serialize on it. The only race is two concurrent `create` arms on
  a year that has no row yet (first booking of the year); the seed pre-creates the current
  year's row to remove that window, and the pipeline retries once on P2002 as a backstop.
- `BookingReferenceCounter @@unique([brandCode, year])` - one counter per brand-year is
  the whole design: uniqueness makes the upsert target deterministic and the sequence gap-
  free per year. `brandCode` is a string, not the `Brand` enum, so a future brand can use
  the shared generator before its enum value ships.
- `WaitlistSignup @@unique([email, zip])` - idempotency at the data layer: the same person
  hitting the zip gate twice (or double-clicking submit) converges on one row. The waitlist
  service treats P2002 as success and returns the existing row (200, not 409 - unlike
  Elevate's waitlist, where a duplicate ACTIVE join is a 409; Apex's capture form must
  never dead-end, so the idempotent-success semantics are pinned by the zip-gate rules in
  foundation-spec section 5).
- `Service.basePrice = 0` across the whole MVP seed (decision table #3): prices live in
  absolute option deltas, so the engine's base step contributes 0 for PRICED/FROM services,
  and QUOTE services never run the engine at all - 0 keeps the column NOT NULL with no dead
  money. `fromPrice` is set only for FROM services and is display-only (never summed - the
  Elevate `beauty` lesson).
- `Service.pricingRef` - equals `slug` for all 11 MVP services, but stays a separate
  column (Elevate precedent: `nutrition-coaching` diverged). The id-alignment contract
  resolves against `pricingRef`, never against `slug`.
- `ServiceConfigGroup.uiHint` - presentation only ("matrix-axis", "load-estimator",
  "device-checklist", "frequency", or NULL). The pricing engine and validation layers
  never read it; semantics live exclusively in `inputType`. It exists so the junk-removal
  visual load estimator and the cleaning matrix are DATA, not per-service frontend code.
- `ServiceConfigGroup` with `inputType = TEXTAREA` - the QUOTE description input, seeded
  with `key = "description"`, `isRequired = true` for the three QUOTE services. It has NO
  pricing counterpart (exempt from id-alignment) and NO options. The pipeline persists the
  submitted text into `BookingConfiguration.description` - it is NOT duplicated into
  `selections`.
- `BookingConfiguration.selections` Json shape -
  `Record<group.key, string | number | boolean | string[]>` where values are option keys
  (verbatim), a number (QUANTITY), or a boolean (TOGGLE). This is the pinned deviation 4
  shape (`{ selections, quantity }`), identical to the P14-M2 `configuration.selections`
  contract, snapshotted immutably.
- `ServiceConfigOption.priceDelta >= 0` in MVP - zod-enforced, not a DB constraint
  (Elevate precedent). Discounts are expressed as `ServicePricingRule` effects, never as
  negative option deltas; the booking-creation recompute is the integrity guard.
- `ServicePricingRule.trigger/effect Json` - Json, not columns, because trigger kinds are
  an open set owned by the rules evaluator (`modules/pricing`); adding a trigger kind must
  not require a migration. The seed validates every trigger against the service's groups
  (section 7.4) so no unresolvable rule can enter the DB.
- `ServiceCategory.status` uses the new `CategoryStatus` enum (author decision, decision
  table #2).

## 6. Seed strategy

### 6.1 seed-data/ file inventory

| File | Owns | Consumed by | Notes |
|---|---|---|---|
| `prisma/seed-data/apex-catalog.json` | STRUCTURE + COPY: categories; services (slug, name, summary, description, category, badges, claims block, recurring eligibility, sort order); config groups/options (ids, labels, sublabels, input types, required flags, ui hints, bounds) | `prisma/seed.ts` | The Apex analog of Elevate's `services.json`. Carries NO money. |
| `prisma/seed-data/apex-pricing.v1.json` | MONEY + MODES + RULES: per-`pricingRef` entry with `mode`, `base_price`, `from_price?`, `modifiers[]` (deltas), `fees[]`, `rules[]` | `prisma/seed.ts` (deltas, rules) and `modules/pricing` (version string constant) | EXTENDED Elevate `pricing.v1.json` schema - see 6.2. All MVP amounts derived from the verified frontend data; everything else is labeled SAMPLE. |
| `prisma/seed-data/service-area.v1.json` | THE SHARED Raleigh zip allowlist (Wake County) | `prisma/seed.ts` -> `ServiceAreaZip` | OWNERSHIP NOTE: Apex owns this file as a cross-brand asset (PRD "shared assets Apex deposits for future brands"). Future Raleigh brands consume this exact file (copy or package import); changes land here first and propagate outward. Format: `{ "version": "service-area.v1", "owner_brand": "apex", "region": "Wake County, NC", "zips": [ { "zip": "27513", "city": "Cary", "county": "Wake" }, ... ] }`. |

### 6.2 apex-pricing.v1.json extended schema

Strictly ADDITIVE over Elevate's `PricingTableSchema`
(`Client/src/lib/pricing/types.ts`): three new keys per service entry (`mode`,
`from_price`, `rules`), all with defaults (`mode: "PRICED"`, `rules: []`), so any valid
Elevate pricing file still parses under the Apex schema. `Modifier` and `Fee` shapes are
UNCHANGED (bit-for-bit engine parity). Rule objects carry `key` (never `id`) plus an
explicit `sortOrder` so they parse under the `PricingRuleSchema` of `03-pricing-engine.md`;
`modifiers[]` and their `options[]` keep Elevate's `id` field name untouched.

```jsonc
{
  "version": "apex-pricing.v1",
  "currency": "USD",
  "note": "SAMPLE PLACEHOLDER PRICES - cleaning/lawn amounts verified against client/src/data; the rest are drafts.",
  "services": {
    "<pricingRef>": {
      "mode": "PRICED",                                  // NEW: "PRICED" | "FROM" | "QUOTE" (default "PRICED")
      "base_price": { "amount": 0, "currency": "USD" },   // 0 for every MVP service (decision #3); prices live in option deltas
      "from_price": { "amount": 9900, "currency": "USD" }, // NEW, optional: FROM display band only
      "modifiers": [ /* Elevate Modifier shape, unchanged */ ],
      "fees":      [ /* Elevate Fee shape, unchanged */ ],
      "rules": [                                          // NEW: conditional rules layer (default [])
        {
          "key": "freq-weekly-discount",
          "label": "Weekly discount (Sample)",
          "trigger": { "kind": "option_selected", "group": "frequency", "option": "weekly" },
          "effect":  { "kind": "discount", "calc": "percent", "value": 20 },
          "sortOrder": 1
        }
      ]
    }
  }
}
```

### 6.3 prisma/seed.ts flow

Idempotent and rerunnable (mirrors the Elevate seed shape: upsert services, resync config
by delete-and-recreate, prune strays). Run with `npm run prisma:seed`.

1. Load and zod-parse the three seed-data files (the extended pricing schema of 6.2, the
   catalog schema, the service-area schema). Parse failure = hard exit, nonzero code.
2. Cross-validate the id-alignment contract and money invariants (section 6.4). Any
   violation = hard exit BEFORE any write.
3. Upsert `ServiceCategory` rows by `slug` (`recurring-core`, `one-time`, `specialty` -
   grouping is seed data, product-adjustable).
4. For each catalog service: join to its pricing entry by `pricing_ref`; upsert `Service`
   by `slug` with `pricingMode` = pricing entry `mode`, `basePrice` = `base_price.amount`,
   `fromPrice` = `from_price?.amount ?? null`, `status` = `ACTIVE` (or catalog override).
5. Resync config per service (Elevate precedent):
   `deleteMany ServiceConfigGroup where serviceId` (options cascade), then recreate
   groups + nested options in catalog order, with `sortOrder` = array index and
   `priceDelta` looked up from pricing by `(pricingRef, group.key, option.key)` - keys
   copied VERBATIM (`co.id`, `ch.id`), never slugged.
6. Resync `ServicePricingRule` per service the same way: `deleteMany` then recreate from
   the pricing entry's `rules[]` - `key`/`label`/`trigger`/`effect` copied verbatim and
   `sortOrder` taken from the rule's explicit `sortOrder` JSON field (schema default 0),
   NOT from the array index: rules evaluate `sortOrder` asc, tie-broken by `key` asc
   (03-pricing-engine.md), and the file field is the single ordering authority.
7. Upsert `ServiceAreaZip` by `zip` from `service-area.v1.json` with `active: true`;
   set `active: false` on any DB zip NOT present in the file (deactivate, never delete).
8. Upsert the `BookingReferenceCounter` row for `("APX", currentYear)` with
   `create: { counter: 0 }, update: {}` - the empty update arm guarantees a rerun NEVER
   resets a live counter.
9. Print a summary line (categories/services/groups/options/rules/zips counts), mirroring
   the Elevate seed's closing log.

Skeleton of the load-bearing parts:

```ts
// prisma/seed.ts (skeleton - full listing is implementation work)
import { PrismaClient, PricingMode, ConfigInputType, ConfigStatus } from "@prisma/client";
import { readFileSync } from "fs";
import { join } from "path";

const prisma = new PrismaClient();
const DATA = join(__dirname, "seed-data");
const catalog = JSON.parse(readFileSync(join(DATA, "apex-catalog.json"), "utf8"));
const pricing = JSON.parse(readFileSync(join(DATA, "apex-pricing.v1.json"), "utf8"));
const area = JSON.parse(readFileSync(join(DATA, "service-area.v1.json"), "utf8"));

const INPUT_MAP: Record<string, ConfigInputType> = {
  select: "SELECT", multiselect: "MULTISELECT", quantity: "QUANTITY",
  toggle: "TOGGLE", textarea: "TEXTAREA",
};

/** Option delta (cents) by verbatim ids - the Elevate modifierFor pattern. */
function deltaFor(pricingRef: string, groupKey: string, optionKey: string): number {
  const mod = pricing.services?.[pricingRef]?.modifiers?.find((m: any) => m.id === groupKey);
  const opt = mod?.options?.find((o: any) => o.id === optionKey);
  const delta = opt?.delta;
  if (delta && delta.currency !== pricing.currency) {
    throw new Error(`Currency mismatch on ${pricingRef}/${groupKey}/${optionKey}`);
  }
  if (delta && delta.amount < 0) {
    throw new Error(`Negative option delta on ${pricingRef}/${groupKey}/${optionKey} - discounts must be rules`);
  }
  return delta?.amount ?? 0;
}

/** Id-alignment enforcement: fail LOUDLY before any write (see 6.4). */
function assertAligned(svc: any, entry: any): void {
  const modIds = new Set((entry.modifiers ?? []).map((m: any) => m.id));
  for (const group of svc.config_options ?? []) {
    if (group.input === "textarea") continue; // QUOTE description: no pricing counterpart
    if (!modIds.has(group.id)) {
      throw new Error(`[id-alignment] group "${group.id}" on ${svc.id} has no pricing modifier under ${svc.pricing_ref}`);
    }
    const mod = entry.modifiers.find((m: any) => m.id === group.id);
    const optIds = new Set((mod.options ?? []).map((o: any) => o.id));
    for (const choice of group.choices ?? []) {
      if (!optIds.has(choice.id)) {
        throw new Error(`[id-alignment] option "${group.id}/${choice.id}" on ${svc.id} missing from pricing`);
      }
    }
  }
  for (const rule of entry.rules ?? []) {
    const g = (svc.config_options ?? []).find((x: any) => x.id === rule.trigger.group);
    if (!g) throw new Error(`[id-alignment] rule "${rule.key}" targets unknown group "${rule.trigger.group}"`);
    if (rule.trigger.kind === "option_selected" &&
        !(g.choices ?? []).some((c: any) => c.id === rule.trigger.option)) {
      throw new Error(`[id-alignment] rule "${rule.key}" targets unknown option "${rule.trigger.option}"`);
    }
  }
}
```

### 6.4 How the seed enforces the id-alignment contract

The contract (verified Elevate ground truth): `group.key` equals
`services[pricingRef].modifiers[].id` and `option.key` equals `.options[].id`, carried
VERBATIM - never slugged from labels (real ids like `1`, `xlarge`, `move-in-out` are
hand-authored, and `slugify("Move In/Out") === "move-in-out"` only by luck; `slugify("3
bedrooms") === "3-bedrooms" !== "3"` is the standing counterexample class).

Enforcement mechanics:

1. Keys are only ever COPIED from source ids (`group.id`, `choice.id`) - there is no
   slugify call anywhere in `seed.ts`, by construction.
2. `assertAligned` (above) runs for every PRICED/FROM service BEFORE any write: every
   non-TEXTAREA catalog group id must exist as a pricing modifier id under the service's
   `pricing_ref`, every choice id must exist in that modifier's options, and every rule
   trigger must resolve to a real group (and option, for `option_selected`). One miss
   fails the whole seed with a named path.
3. The reverse direction warns (does not fail): a pricing modifier with no catalog group
   is unreachable money and logged as `[id-alignment][warn]`.
4. Currency and sign are validated per delta (`deltaFor` above): the delta currency must
   equal the table currency, and negative deltas are rejected (discounts are rules).
5. The DB backstops with `@@unique([serviceId, key])` / `@@unique([groupId, key])` - a
   duplicated source id fails the transaction rather than silently overwriting.

### 6.5 Catalog key map (group keys per service - stable analytics ids)

Keys below are the seed's verbatim ids. Frontend-verified ids are marked FE (they come
letter-for-letter from `client/src/data/**`); the rest are author-drafted SAMPLE ids that
become pinned once the seed lands.

This table mirrors the canonical registry in `03-pricing-engine.md` sections 7/7.1 (which owns
keys, deltas, and rule keys); regenerate it from there, never edit it independently.

| Service (slug) | Mode | Group keys (inputType) | Option keys | Rule keys |
|---|---|---|---|---|
| cleaning | PRICED | `cleaning-type` (SELECT), `bedrooms` (SELECT), `bathrooms` (SELECT), `frequency` (SELECT) | `standard`/`deep`/`move-in-out`; `1`..`5`; `1`..`4`; `one-time`/`weekly`/`biweekly`/`monthly` | `freq-weekly-discount` (20%), `freq-biweekly-discount` (15%), `freq-monthly-discount` (10%) - percents SAMPLE |
| lawn-care | PRICED | `lot-size` (SELECT) | FE: `small`/`medium`/`large`/`xlarge` | none |
| junk-removal | PRICED | `load-size` (SELECT, uiHint "load-estimator") | `quarter`/`half`/`three-quarter`/`full` | none |
| pool | PRICED | `pool-size` (SELECT), `frequency` (SELECT, uiHint "frequency") | FE: `small`/`medium`/`large`/`custom`; FE: `weekly`/`biweekly`/`monthly` | `freq-monthly-discount` (min_selected n/a; option_selected(frequency, monthly) -> percent 15, models the frontend 0.85 multiplier) |
| pest-control | PRICED | `plan` (SELECT), `pest-type` (SELECT) | SAMPLE: `one-time`/`quarterly`/`monthly`; FE: `general`/`indoor`/`outdoor`/`rodent` (deltas 0) | none |
| smart-home | PRICED | `devices` (MULTISELECT, uiHint "device-checklist", selectMin 1) | SAMPLE: `smart-plug-hub`/`video-doorbell`/`security-camera`/`smart-thermostat`/`smart-lock` | `multi-device-discount` (min_selected(devices, 3) -> discount percent 15) |
| power-washing | FROM | `surfaces` (MULTISELECT, selectMin 1) | SAMPLE: `fence`/`driveway-sidewalk`/`deck-patio`/`house-siding` | none |
| handyman | FROM | `job-type` (SELECT) | SAMPLE: `small-repair`/`furniture-assembly`/`fixture-install`/`tv-mounting` | none |
| painting | QUOTE | `description` (TEXTAREA, required) | none | none |
| home-security | QUOTE | `description` (TEXTAREA, required) | none | none |
| tree-stump | QUOTE | `description` (TEXTAREA, required) | none | none |

### 6.6 Worked seed-data example: cleaning, end-to-end

Money verified against `client/src/data/HouseCleaningData/configuratorData.ts`
(dollars -> cents): base Standard $95, Deep $145, Move In/Out $195; +$25/bedroom;
+$15/bathroom. Frequency percent values are SAMPLE placeholders (foundation-spec
section 3): one-time 0, monthly 10, biweekly 15, weekly 20.

`apex-catalog.json` fragment:

```json
{
  "id": "cleaning",
  "title": "Home Cleaning",
  "category": "recurring-core",
  "pricing_ref": "cleaning",
  "summary": "Recurring or one-time cleaning, priced by beds x baths x type x frequency.",
  "badges": ["Most booked"],
  "is_recurring_eligible": true,
  "sort_order": 0,
  "config_options": [
    {
      "id": "cleaning-type", "label": "Cleaning type", "input": "select",
      "required": true, "ui_hint": "matrix-axis",
      "choices": [
        { "id": "standard",    "label": "Standard" },
        { "id": "deep",        "label": "Deep Clean" },
        { "id": "move-in-out", "label": "Move In/Out" }
      ]
    },
    {
      "id": "bedrooms", "label": "Bedrooms", "input": "select",
      "required": true, "ui_hint": "matrix-axis",
      "choices": [
        { "id": "1", "label": "1 bedroom" }, { "id": "2", "label": "2 bedrooms" },
        { "id": "3", "label": "3 bedrooms" }, { "id": "4", "label": "4 bedrooms" },
        { "id": "5", "label": "5 bedrooms" }
      ]
    },
    {
      "id": "bathrooms", "label": "Bathrooms", "input": "select",
      "required": true, "ui_hint": "matrix-axis",
      "choices": [
        { "id": "1", "label": "1 bathroom" }, { "id": "2", "label": "2 bathrooms" },
        { "id": "3", "label": "3 bathrooms" }, { "id": "4", "label": "4 bathrooms" }
      ]
    },
    {
      "id": "frequency", "label": "Frequency", "input": "select",
      "required": true, "ui_hint": "frequency",
      "choices": [
        { "id": "one-time", "label": "One-time" },
        { "id": "weekly",   "label": "Weekly" },
        { "id": "biweekly", "label": "Every two weeks" },
        { "id": "monthly",  "label": "Monthly" }
      ]
    }
  ]
}
```

`apex-pricing.v1.json` entry (note: NO money in the catalog fragment above - it all
lives here; the seed joins the two by the verbatim ids):

```json
"cleaning": {
  "mode": "PRICED",
  "base_price": { "amount": 0, "currency": "USD" },
  "modifiers": [
    {
      "id": "cleaning-type", "label": "Cleaning type", "type": "select", "applies": "flat",
      "options": [
        { "id": "standard",    "label": "Standard",    "delta": { "amount": 9500,  "currency": "USD" } },
        { "id": "deep",        "label": "Deep Clean",  "delta": { "amount": 14500, "currency": "USD" } },
        { "id": "move-in-out", "label": "Move In/Out", "delta": { "amount": 19500, "currency": "USD" } }
      ]
    },
    {
      "id": "bedrooms", "label": "Bedrooms", "type": "select", "applies": "flat",
      "options": [
        { "id": "1", "label": "1 bedroom",  "delta": { "amount": 2500,  "currency": "USD" } },
        { "id": "2", "label": "2 bedrooms", "delta": { "amount": 5000,  "currency": "USD" } },
        { "id": "3", "label": "3 bedrooms", "delta": { "amount": 7500,  "currency": "USD" } },
        { "id": "4", "label": "4 bedrooms", "delta": { "amount": 10000, "currency": "USD" } },
        { "id": "5", "label": "5 bedrooms", "delta": { "amount": 12500, "currency": "USD" } }
      ]
    },
    {
      "id": "bathrooms", "label": "Bathrooms", "type": "select", "applies": "flat",
      "options": [
        { "id": "1", "label": "1 bathroom",  "delta": { "amount": 1500, "currency": "USD" } },
        { "id": "2", "label": "2 bathrooms", "delta": { "amount": 3000, "currency": "USD" } },
        { "id": "3", "label": "3 bathrooms", "delta": { "amount": 4500, "currency": "USD" } },
        { "id": "4", "label": "4 bathrooms", "delta": { "amount": 6000, "currency": "USD" } }
      ]
    },
    {
      "id": "frequency", "label": "Frequency", "type": "select", "applies": "flat",
      "options": [
        { "id": "one-time", "label": "One-time",       "delta": { "amount": 0, "currency": "USD" } },
        { "id": "weekly",   "label": "Weekly",          "delta": { "amount": 0, "currency": "USD" } },
        { "id": "biweekly", "label": "Every two weeks", "delta": { "amount": 0, "currency": "USD" } },
        { "id": "monthly",  "label": "Monthly",         "delta": { "amount": 0, "currency": "USD" } }
      ]
    }
  ],
  "fees": [],
  "rules": [
    {
      "key": "freq-weekly-discount", "label": "Weekly discount (Sample)",
      "trigger": { "kind": "option_selected", "group": "frequency", "option": "weekly" },
      "effect":  { "kind": "discount", "calc": "percent", "value": 20 },
      "sortOrder": 1
    },
    {
      "key": "freq-biweekly-discount", "label": "Bi-weekly discount (Sample)",
      "trigger": { "kind": "option_selected", "group": "frequency", "option": "biweekly" },
      "effect":  { "kind": "discount", "calc": "percent", "value": 15 },
      "sortOrder": 2
    },
    {
      "key": "freq-monthly-discount", "label": "Monthly discount (Sample)",
      "trigger": { "kind": "option_selected", "group": "frequency", "option": "monthly" },
      "effect":  { "kind": "discount", "calc": "percent", "value": 10 },
      "sortOrder": 3
    }
  ]
}
```

Resulting DB rows (abridged):

| Table | Rows |
|---|---|
| `Service` | 1 row: `slug "cleaning"`, `pricingMode PRICED`, `pricingRef "cleaning"`, `basePrice 0`, `fromPrice NULL`, `isRecurringEligible true` |
| `ServiceConfigGroup` | 4 rows: keys `cleaning-type`, `bedrooms`, `bathrooms`, `frequency`; all SELECT, required, `applies FLAT`, sortOrder 0..3 |
| `ServiceConfigOption` | 16 rows: 3 + 5 + 4 + 4, `priceDelta` per the pricing entry (frequency options all 0) |
| `ServicePricingRule` | 3 rows: keys `freq-weekly-discount` (20), `freq-biweekly-discount` (15), `freq-monthly-discount` (10) |

Verification math (engine recompute, integer cents; frontend cross-check in dollars) -
`total = 0 + typeDelta + bedsDelta + bathsDelta`, then
`- Math.round(subtotal * pct / 100)`:

| Selection | Engine (cents) | Frontend check |
|---|---|---|
| 1bd / 1ba / standard / one-time | 0 + 9500 + 2500 + 1500 = 13500 | (95 + 25 + 15) = $135.00. Match. |
| 3bd / 2ba / deep / biweekly | sub 0 + 14500 + 7500 + 3000 = 25000; discount round(25000 * 15/100) = 3750; total 21250 | (145 + 75 + 30) * 0.85 = $212.50. Match. |
| 5bd / 4ba / move-in-out / weekly | sub 0 + 19500 + 12500 + 6000 = 38000; discount round(38000 * 20/100) = 7600; total 30400 | (195 + 125 + 60) * 0.80 = $304.00. Match. |

Every beds x baths x type x frequency combination is exact by construction because all
four axes are linear in cents and the percent rule uses the engine's fee rounding.

## 7. Migration notes

- Initial migration: `npx prisma migrate dev --name init_apex` produces ONE migration
  containing every enum + table above. The repo is empty, so there are no backfill
  concerns; `migration_lock.toml` (provider `postgresql`) is committed alongside, exactly
  as Elevate does.
- Dev loop: `npm run db:push` is acceptable ONLY for local prototyping before the first
  migration is cut; once `migrations/` exists, all schema changes go through
  `prisma migrate dev` locally and `prisma migrate deploy` in CI/prod (Elevate scripts
  ported verbatim per foundation-spec section 0).
- Additive-safety conventions (inherited from Elevate, `service-configuration-model.md`
  section 2.4 and the `add_coming_soon_category_status` migration):
  - Every column added to a populated table is nullable or defaulted; no
    required-without-default column, ever.
  - Enum changes are append-only: `ALTER TYPE ... ADD VALUE` (optionally
    `BEFORE`/`AFTER` to mirror schema order, as Elevate's migration does). Never rename
    or remove an enum value in place; removal is an expand-and-contract sequence (add new
    value, migrate rows, drop via type rebuild) executed only when genuinely needed.
  - Keep enum-value additions in their own single-statement migration (Postgres restricts
    using a value added in the same transaction; Elevate's precedent migration is exactly
    one statement).
  - Never reuse a booking `reference` or reset a `BookingReferenceCounter` row in any
    migration or seed (the seed's empty `update: {}` arm encodes this).
- Predictable next migrations (all additive by design): admin `User`/auth tables when the
  post-MVP admin surface lands (Deviation 3 note); `NOTIFIED`-flow columns on
  `WaitlistSignup` if real notifications ever arrive; new `Brand` enum values for future
  Raleigh brands.

## 8. Enum re-export (src/enums/index.ts)

Single source of truth is `schema.prisma`; the app imports enums only via `src/enums`
(Elevate convention). The complete re-export list for this schema:

```ts
export {
  Brand,
  PricingMode,
  ServiceStatus,
  CategoryStatus,
  ConfigInputType,
  ConfigApplies,
  ConfigStatus,
  BookingStatus,
  BookingSource,
  ContactMethod,
  QuoteStatus,
  QuoteSource,
  PMBundle,
  WaitlistSource,
  WaitlistStatus,
  ProApplicationStatus,
  FormKind,
} from "@prisma/client";
```

## 9. Open questions (product owner)

1. Frequency discount percentages are SAMPLE (weekly 20 / biweekly 15 / monthly 10, per
   foundation-spec placeholder). Confirm real values before launch; they are one seed
   edit each.
2. Category grouping (`recurring-core` / `one-time` / `specialty`) and per-category copy
   are seed data - confirm the grouping and display names.
3. FROM-band anchors: `power-washing` and `handyman` need confirmed `from_price` values
   and modifier sets (frontend drafts say "From $99" / "From $65", both marked DRAFT).
4. Pest-control `plan` options and prices are SAMPLE (frontend has pest types but no plan
   pricing); pool `frequency` maps the frontend's monthly 0.85 multiplier to a 15 percent
   rule - confirm that interpretation.
5. `clientRequestId` idempotency (author decision): confirm the frontend will send the
   contract's `request_id` on `POST /bookings` so duplicate submits dedupe; if not, the
   nullable column is inert.
6. `FormSubmissionLog` retention: append-only and unbounded. Fine for the demo scope;
   confirm whether a cleanup job is wanted post-MVP (owner: backend dev, revisit at admin-
   surface time).
