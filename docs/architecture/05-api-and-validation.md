# REST API reference and validation layer

Section 05 of the Apex Total Home Services backend architecture. Covers deliverables 5 (full REST
API design with request/response examples) and 6 (validation layer: zod schemas, validation
middleware, business validation, ZIP validation, quote validation).

Companion inputs this section assumes but does not duplicate:

- `foundation-spec.md` (pinned module names, Prisma models/enums, API surface, zip-gate semantics)
- `context-prd.md` (business rules, the P14-M2 booking_request contract, acceptance criteria)
- `elevate-conventions.md` (verified Elevate server conventions: envelope, `ApiError`, `validate`
  middleware, module layering)
- The companion doc-set sections for the data model (Prisma schema), pricing engine, and booking
  pipeline. Where this section shows selection keys, seed prices, or pipeline steps, those sections
  are authoritative; this section only fixes the wire contract.

All money in this document is integer minor units (cents, `"currency": "USD"`). All ids are UUID
strings. Base path is `/api/v1`.

## Decisions made in this section

| # | Decision | Choice | Rejected alternative and why |
|---|----------|--------|------------------------------|
| D1 | Response casing | DB-backed catalog resources serialize camelCase (Elevate serializer parity: `pricingMode`, `configGroups`, `priceDelta`); objects published by the P14-M2 contract or the PRD keep their snake_case field names verbatim (`displayed_price`, `line_items`, `waitlist_signup`, `quote_request`, `units_est`) | All-snake or all-camel: either one breaks a verified ground truth (Elevate config payload is camelCase; the booking contract is snake_case). Each ground truth governs the objects it defines. |
| D2 | `POST /bookings` status code | 200 for BOTH arms of the zip-gate discriminated union | 201 for BOOKED / 4xx for WAITLISTED. Pinned by foundation-spec section 5; see 5.6 for the full rationale. |
| D3 | Booking lookup guard | `GET /bookings/:reference?email=` requires BOTH values to match; any miss returns a uniform 404 `BOOKING_NOT_FOUND` | Reference-only lookup: APX-2026-NNNN is sequential, therefore enumerable; email match is the pinned anti-enumeration mechanism. |
| D4 | Shared zod primitives | `src/types/contract.schemas.ts` holds the P14-M2 primitives (`moneySchema`, `lineItemSchema`, `displayedPriceSchema`, `configValueSchema`, `selectionsSchema`, `zipSchema`); module `*.validation.ts` files compose them | Duplicating the Money/ConfigValue shapes per module: drift risk on a published contract. `src/types/` is Elevate's home for shared cross-module types. |
| D5 | QUOTE description minimum | Enforced at layer 2 (needs `service.pricingMode` from the DB), not in the transport schema | A `.min(10)` in zod would force the rule onto PRICED bookings that legitimately omit `description`. |
| D6 | Client `quote_request` flag | Accepted by the schema for contract compatibility, then IGNORED; the server derives it from `service.pricingMode` | Rejecting a mismatched flag with 4xx: adds a failure mode for a value the server never trusts anyway. |
| D7 | SELECT/MULTISELECT selection values | Must be STRING option keys (`"3"`, not `3`); numbers are only valid for QUANTITY input groups | Silent number-to-string coercion: hides client bugs and breaks the verbatim id-alignment contract. Violation is 422 `INVALID_SELECTION_VALUE`. |
| D8 | `schedule_preferences` | Accepted as an opaque optional field and persisted verbatim to `Booking.schedulePreferences Json?` (the column exists -- data-model decision #5); NOT interpreted in MVP, scheduling still happens after submit (`next: "coordinator_confirms"`) | Dropping the P14-M2 contract field: the column is already modeled for contract parity, and the coordinator benefits from seeing the customer's preferred windows even without availability logic. |
| D9 | Waitlist duplicate handling | Idempotent: create returns 201, duplicate `[email, zip]` returns 200 with the existing record | Elevate's 409-on-existing. See Deviation D-5 below. |
| D10 | Cleaning seed representation in examples | Examples use `basePrice = 0` with cleaning-type deltas 9500 / 14500 / 19500 (the canonical pick, generalized to every MVP service by the data-model and pricing-engine sections) | The base-9500 + deltas 0/5000/10000 variant. Totals are identical either way; only the line-item split differs. |
| D11 | Zod-failure details shape | `errors: { code: "VALIDATION_FAILED", issues: [{ path, message }] }` | Elevate's bare `[{ path, message }]` array. See Deviation D-6. |
| D12 | Pro acknowledgements | Transport validates shape only; completeness against `TRADE_REQUIREMENTS` runs at layer 2 via an exported helper so failures carry stable codes | A zod `superRefine` doing the completeness check: failures would surface as generic `VALIDATION_FAILED` issues, losing `MISSING_ACKNOWLEDGEMENT` / `UNKNOWN_ACKNOWLEDGEMENT`. |

## Envelope and error conventions (Elevate parity)

### Success envelope

Every 2xx response is built by `sendSuccess(res, data, message, statusCode, meta?)`:

```json
{ "success": true, "message": "Success", "data": { }, "meta": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 } }
```

`meta` appears only when supplied. MVP note: no Apex list endpoint paginates (11 services, one
county of ZIPs), so `meta` is never emitted in MVP; the plumbing (`buildMeta`, `pagination.ts`)
is ported anyway for the post-MVP admin surface.

### Failure envelope

Produced only by the global error handler (`middleware/error-handler.ts`, ported from Elevate):

```json
{ "success": false, "message": "Human-readable summary", "errors": { "code": "STABLE_CODE" }, "stack": "only when NODE_ENV !== production" }
```

Key facts, verified against Elevate source:

- `ApiError` carries `statusCode`, `message`, and an optional `details` payload. The handler
  serializes `details` under the JSON key **`errors`** (not `details`). All examples below use
  `errors`.
- Apex convention on top of that: every operationally thrown `ApiError` passes a details object
  whose first field is a stable machine-readable `code` string (see the catalog in section 8),
  plus whatever context helps the client recover (for example the recomputed price on
  `PRICE_MISMATCH`). Clients branch on `errors.code`, never on `message` text.
- Handler translation table (Elevate parity): `ApiError -> its statusCode`; `ZodError -> 422`;
  Prisma `P2002 -> 409`, `P2025 -> 404`, other known Prisma -> 400; anything else -> 500.
  500s log via `logger.error` and carry no `errors.code`.

### Wire values for published contract enums

The PRD publishes lowercase wire values for the waitlist record; Prisma enums are
SCREAMING_SNAKE. Serializers map at the boundary (and zod `z.preprocess` maps inbound):

| Prisma enum value | Wire value |
|---|---|
| `Brand.APEX` | `"apex"` |
| `WaitlistSource.SERVICE_AREA_MISS` | `"service-area-miss"` |
| `WaitlistSource.SERVICE_AREA_PAGE` | `"service-area-page"` |
| `PMBundle.TURNOVER` | `"turnover"` (inbound wire; responses echo the wire form) |
| `PMBundle.LISTING_PREP` | `"listing_prep"` |

Everything else (service status, booking status, pricing mode, input types) crosses the wire in
its Prisma spelling (`"ACTIVE"`, `"PENDING"`, `"PRICED"`, `"SELECT"`).

## Endpoint summary

All endpoints are PUBLIC. There is no authentication anywhere on the MVP surface -- this is
pinned Deviation D-3 (Elevate guards `/bookings` with `authenticate`; Apex has no customer
accounts per the PRD, contact is snapshotted per booking, and abuse control is rate limiting).
`middleware/auth.ts` is scaffolded but unmounted; the post-MVP admin surface (CRUD on config
groups/options/rules, booking status transitions) will mount `authenticate` + `authorize`
following Elevate's staff-router pattern.

| # | Method | Path (under `/api/v1`) | Auth | Limiter(s) | Purpose |
|---|--------|------------------------|------|------------|---------|
| 1 | GET | `/health` | public | general | Liveness + `SELECT 1` DB probe |
| 2 | GET | `/services` | public | general | Catalog list (category/status filter) |
| 3 | GET | `/services/:idOrSlug` | public | general | Service detail |
| 4 | GET | `/services/:idOrSlug/config` | public | general | Configurator payload: service + groups + options + rules summary, one round trip |
| 5 | POST | `/services/:idOrSlug/config/price` | public | general + preview | Live price preview (Step 3) |
| 6 | POST | `/bookings` | public | general + form | Core Flow submit; zip-gated discriminated union |
| 7 | GET | `/bookings/:reference` | public | general + lookup | Success-page re-read; anti-enumeration = reference AND email must match |
| 8 | POST | `/waitlist` | public | general + form | Waitlist capture (zip miss + /service-area page) |
| 9 | GET | `/service-area/validate` | public | general | Zip pre-check for the address step |
| 10 | GET | `/service-area/zips` | public | general | Full allowlist for the /service-area page |
| 11 | POST | `/pm-requests` | public | general + form | Property-manager B2B form -> QuoteRequest + PMRequest |
| 12 | POST | `/pro-applications` | public | general + form | Become-an-Apex-Pro form |

These 12 endpoints are the ENTIRE MVP surface. In particular, `modules/quotes` is a ROUTELESS
internal module (Elevate `notifications` precedent): `QuoteRequest` rows are written by the
booking pipeline and the PM form and read via Prisma Studio / psql in the demo; public or admin
`/quotes` read endpoints are post-MVP (they arrive with the authenticated admin surface).

## Rate limits and CORS

### Rate-limit table (`middleware/rate-limit.ts`)

| Limiter | Mounted on | Window | Max/IP | Notes |
|---|---|---|---|---|
| `generalRateLimiter` | `app.use("/api", ...)` (everything) | `RATE_LIMIT_WINDOW_MS` (default 900000 = 15 min) | `RATE_LIMIT_MAX` (default **300**) | Elevate ships default 100; Apex raises the DEFAULT to 300 because an anonymous configurator fires a preview call per selection change. Env-tunable, same keys. See Deviation D-8. |
| `previewRateLimiter` | `POST /services/:idOrSlug/config/price` | 15 min | 120 | Client debounces; 120 covers a full matrix exploration session. |
| `formRateLimiter` | `POST /bookings`, `POST /waitlist`, `POST /pm-requests`, `POST /pro-applications` | 15 min | 20 | Mirrors Elevate's `authRateLimiter` pattern (tight limiter on anonymous writes). |
| `lookupRateLimiter` | `GET /bookings/:reference` | 15 min | 30 | Backstop against reference/email pair guessing on top of the uniform 404. |

429 responses use the failure envelope, emitted directly by the limiter's `handler`:

```json
{ "success": false, "message": "Too many requests, please try again later", "errors": { "code": "RATE_LIMITED" } }
```

### CORS

Elevate parity in `app.ts`:

```ts
cors({
  origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(","),
  credentials: true,
})
```

MVP runs no cookies and no Authorization headers, so the default `CORS_ORIGIN=*` is acceptable in
dev/demo. Production sets `CORS_ORIGIN` to the Next.js origin(s) (comma-separated). Note for the
post-MVP admin work: browsers reject wildcard origin combined with actual credentialed requests,
so the admin rollout must set explicit origins before mounting auth.

Wiring order (verified Elevate order, unchanged): `helmet -> cors -> express.json({limit:"1mb"})
-> express.urlencoded -> generalRateLimiter on /api -> apiRouter on /api/v1 -> notFound ->
errorHandler`. `app.disable("x-powered-by")`.

## Endpoint reference

Every entry shows: request, success response, and at least one error response. Envelope wrappers
are shown in full the first few times, then `data` payloads only where the wrapper adds nothing.

### 5.1 GET /health

Request: `GET /api/v1/health` (no params).

Success 200:

```json
{
  "success": true,
  "message": "OK",
  "data": { "status": "ok", "db": "up", "version": "apex-server/0.1.0" }
}
```

Error 503 (DB probe `SELECT 1` failed):

```json
{
  "success": false,
  "message": "Service unavailable",
  "errors": { "code": "DB_UNAVAILABLE", "db": "down" }
}
```

### 5.2 GET /services

Request: `GET /api/v1/services?category=recurring-core`

Query schema: `listServicesQuerySchema` (section 7.4). The public controller intersects any
requested `status` with `PUBLIC_SERVICE_STATUSES = [ServiceStatus.ACTIVE, ServiceStatus.COMING_SOON]`
(SCREAMING_SNAKE const map, Elevate `PUBLIC_STATUSES` precedent) -- `DRAFT` and `INACTIVE` rows
are never listed publicly regardless of the filter.

Success 200 (trimmed to two of the 11 services):

```json
{
  "success": true,
  "message": "Success",
  "data": [
    {
      "id": "0b6c33a2-6a4e-4c0f-9a44-3f9d9c1c2d10",
      "name": "Home Cleaning",
      "slug": "cleaning",
      "summary": "Recurring or one-time cleaning, beds x baths pricing matrix.",
      "category": { "name": "Recurring Core", "slug": "recurring-core" },
      "pricingMode": "PRICED",
      "basePrice": 0,
      "fromPrice": null,
      "currency": "USD",
      "isRecurringEligible": true,
      "badges": ["Most booked"],
      "status": "ACTIVE",
      "sortOrder": 1
    },
    {
      "id": "7e2f1b90-2d1c-4b57-8c3a-5a0e9f4d6b21",
      "name": "Painting",
      "slug": "painting",
      "summary": "Interior and exterior painting. Custom quote.",
      "category": { "name": "One-Time Projects", "slug": "one-time" },
      "pricingMode": "QUOTE",
      "basePrice": 0,
      "fromPrice": null,
      "currency": "USD",
      "isRecurringEligible": false,
      "badges": [],
      "status": "ACTIVE",
      "sortOrder": 9
    }
  ]
}
```

`fromPrice` is display-only (never a math input); QUOTE services carry `basePrice: 0`,
`fromPrice: null` and the UI renders "Custom estimate".

Error 422 (bad status filter):

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": {
    "code": "VALIDATION_FAILED",
    "issues": [{ "path": "status", "message": "Invalid enum value. Expected 'DRAFT' | 'ACTIVE' | 'COMING_SOON' | 'INACTIVE', received 'LIVE'" }]
  }
}
```

### 5.3 GET /services/:idOrSlug

Request: `GET /api/v1/services/cleaning` (accepts UUID or slug; resolver tries UUID shape first,
falls back to slug -- same helper the config sub-module uses).

Success 200: the list item shape plus `description`, `claimsBlock` (pest/security/tree licensing
citations, nullable), `pricingRef`, `createdAt`, `updatedAt`. Not repeated here.

Error 404:

```json
{ "success": false, "message": "Service not found", "errors": { "code": "SERVICE_NOT_FOUND", "idOrSlug": "window-washing" } }
```

### 5.4 GET /services/:idOrSlug/config

The single round trip the booking UI needs for Step 2: service header + ordered `configGroups`
(with ordered `options`) + `rules` summary. Mirrors Elevate's
`ServiceWithConfigResponse`, extended with `pricingMode`, `uiHint`, `applies`, `sublabel`,
`selectMin`/`selectMax`, and the rules array (the Apex conditional-rules extension -- see the
pricing-engine section).

Request: `GET /api/v1/services/cleaning/config`

Success 200 (`data`, abbreviated option lists):

```json
{
  "id": "0b6c33a2-6a4e-4c0f-9a44-3f9d9c1c2d10",
  "name": "Home Cleaning",
  "slug": "cleaning",
  "pricingMode": "PRICED",
  "pricingRef": "cleaning",
  "basePrice": 0,
  "fromPrice": null,
  "currency": "USD",
  "status": "ACTIVE",
  "configGroups": [
    {
      "id": "c1a0. . .", "key": "cleaning-type", "label": "Cleaning type",
      "inputType": "SELECT", "uiHint": "matrix-axis", "applies": "FLAT",
      "isRequired": true, "selectMin": null, "selectMax": null, "sortOrder": 1, "status": "ACTIVE",
      "options": [
        { "id": "o1. . .", "key": "standard", "label": "Standard", "sublabel": null, "priceDelta": 9500, "sortOrder": 1, "status": "ACTIVE" },
        { "id": "o2. . .", "key": "deep", "label": "Deep Clean", "sublabel": null, "priceDelta": 14500, "sortOrder": 2, "status": "ACTIVE" },
        { "id": "o3. . .", "key": "move-in-out", "label": "Move In/Out", "sublabel": null, "priceDelta": 19500, "sortOrder": 3, "status": "ACTIVE" }
      ]
    },
    {
      "id": "c2b1. . .", "key": "bedrooms", "label": "Bedrooms",
      "inputType": "SELECT", "uiHint": "matrix-axis", "applies": "FLAT",
      "isRequired": true, "sortOrder": 2, "status": "ACTIVE",
      "options": [
        { "key": "1", "label": "1 bedroom", "priceDelta": 2500, "sortOrder": 1, "status": "ACTIVE" },
        { "key": "3", "label": "3 bedrooms", "priceDelta": 7500, "sortOrder": 3, "status": "ACTIVE" },
        { "key": "5", "label": "5 bedrooms", "priceDelta": 12500, "sortOrder": 5, "status": "ACTIVE" }
      ]
    },
    {
      "id": "c3c2. . .", "key": "bathrooms", "label": "Bathrooms",
      "inputType": "SELECT", "uiHint": "matrix-axis", "applies": "FLAT",
      "isRequired": true, "sortOrder": 3, "status": "ACTIVE",
      "options": [
        { "key": "2", "label": "2 bathrooms", "priceDelta": 3000, "sortOrder": 2, "status": "ACTIVE" }
      ]
    },
    {
      "id": "c4d3. . .", "key": "frequency", "label": "How often?",
      "inputType": "SELECT", "uiHint": "frequency", "applies": "FLAT",
      "isRequired": true, "sortOrder": 4, "status": "ACTIVE",
      "options": [
        { "key": "one-time", "label": "One-time", "priceDelta": 0, "sortOrder": 1, "status": "ACTIVE" },
        { "key": "weekly", "label": "Weekly", "sublabel": "Save 20%", "priceDelta": 0, "sortOrder": 2, "status": "ACTIVE" },
        { "key": "biweekly", "label": "Bi-weekly", "sublabel": "Save 15%", "priceDelta": 0, "sortOrder": 3, "status": "ACTIVE" },
        { "key": "monthly", "label": "Monthly", "sublabel": "Save 10%", "priceDelta": 0, "sortOrder": 4, "status": "ACTIVE" }
      ]
    }
  ],
  "rules": [
    { "key": "freq-weekly-discount", "label": "Weekly discount (Sample)", "trigger": { "kind": "option_selected", "group": "frequency", "option": "weekly" }, "effect": { "kind": "discount", "calc": "percent", "value": 20 }, "sortOrder": 1 },
    { "key": "freq-biweekly-discount", "label": "Bi-weekly discount (Sample)", "trigger": { "kind": "option_selected", "group": "frequency", "option": "biweekly" }, "effect": { "kind": "discount", "calc": "percent", "value": 15 }, "sortOrder": 2 },
    { "key": "freq-monthly-discount", "label": "Monthly discount (Sample)", "trigger": { "kind": "option_selected", "group": "frequency", "option": "monthly" }, "effect": { "kind": "discount", "calc": "percent", "value": 10 }, "sortOrder": 3 }
  ]
}
```

Notes:

- Group/option `key` values are carried VERBATIM from the pricing table (id-alignment contract;
  key regex `^[a-z0-9]+(?:-[a-z0-9]+)*$`). Frequency percent values (0/10/15/20) are SAMPLE seed
  data per foundation-spec section 3; product confirms real values (owner: product, tracked in
  open questions).
- Groups and options are ordered by `sortOrder`; only `ACTIVE` groups with at least one `ACTIVE`
  option are returned (Elevate rule).
- `rules` is a read-only summary so the UI can render "Save 15%" style captions and the
  smart-home ">= 3 devices saves 15%" banner. The client NEVER computes discounts from it for
  submission; the preview endpoint is the display source of truth.
- The same payload shape serves all 11 services: lawn-care is one `lot-size` SELECT group
  (option keys `small|medium|large|xlarge`, verbatim from the frontend data file), junk-removal is
  one `load-size` SELECT group with `uiHint: "load-estimator"` (keys
  `quarter|half|three-quarter|full`), smart-home is one `devices`
  MULTISELECT with `uiHint: "device-checklist"` plus a `min_selected` rule. QUOTE services
  (painting, home-security, tree-stump) return exactly ONE required TEXTAREA group with key
  `description` (per the data-model and configuration-engine sections) -- it drives the quote
  textarea UI (label, required flag, ordering) from the same generic configurator payload. The
  submitted VALUE still travels as `configuration.description` on the booking body, never inside
  `selections` (a `selections` key resolving to a TEXTAREA group is rejected with 422
  `TEXTAREA_IN_SELECTIONS`; see the configuration-engine section).

Error 404: same `SERVICE_NOT_FOUND` shape as 5.3.

### 5.5 POST /services/:idOrSlug/config/price

Live price preview for Step 3. Runs validation layers 1 and 2 (transport + reference), then the
`PricingModeHandler` registry (see the pricing-engine section). No records are written.

Deviation D-4 (pinned): Elevate's preview body is `{ optionIds: string[] }` (row UUIDs). Apex
takes `{ selections, quantity? }` keyed by group key per the P14-M2 contract, because matrix,
quantity, and toggle semantics cannot be expressed as a flat UUID list.

Request (PRICED, cleaning):

```json
POST /api/v1/services/cleaning/config/price
{
  "selections": { "cleaning-type": "deep", "bedrooms": "3", "bathrooms": "2", "frequency": "biweekly" },
  "quantity": 1
}
```

Success 200:

```json
{
  "success": true,
  "message": "Price preview computed",
  "data": {
    "mode": "PRICED",
    "requires_description": false,
    "requires_pro_confirmation": false,
    "from_price": null,
    "is_from_band": false,
    "displayed_price": {
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
  }
}
```

Math check (engine parity): base 0 x qty 1 (still emits the $0.00 "Base" line -- port fidelity);
+ deep 14500 + beds-3 7500 + baths-2 3000 + biweekly 0 (zero-delta option line, also emitted) =
subtotal 25000; biweekly rule fires: `Math.round(25000 * 15 / 100) = 3750` discount; total 21250.
Dollars: 145 + 75 + 30 = 250, minus 15% = 212.50. Every beds x baths x type x frequency cell is
exact by construction (beds n = n*2500, baths n = n*1500).

Request/response (PRICED, smart-home, discount threshold -- acceptance-load-bearing):

```json
POST /api/v1/services/smart-home/config/price
{ "selections": { "devices": ["video-doorbell", "smart-thermostat", "smart-lock"] } }
```

```json
{
  "mode": "PRICED",
  "requires_description": false,
  "requires_pro_confirmation": false,
  "from_price": null,
  "is_from_band": false,
  "displayed_price": {
    "total": { "amount": 32045, "currency": "USD" },
    "subtotal": { "amount": 37700, "currency": "USD" },
    "line_items": [
      { "label": "Base", "amount": { "amount": 0, "currency": "USD" }, "kind": "base" },
      { "label": "Video doorbell", "amount": { "amount": 9900, "currency": "USD" }, "kind": "option" },
      { "label": "Smart thermostat", "amount": { "amount": 12900, "currency": "USD" }, "kind": "option" },
      { "label": "Smart lock", "amount": { "amount": 14900, "currency": "USD" }, "kind": "option" },
      { "label": "Multi-device discount (15%)", "amount": { "amount": -5655, "currency": "USD" }, "kind": "discount" }
    ],
    "pricing_version": "apex-pricing.v1",
    "is_estimate": true
  }
}
```

Math check: 9900 + 12900 + 14900 = subtotal 37700; `Math.round(37700 * 15 / 100) = 5655`;
total 32045 (matches the pricing-engine section's worked acceptance example).

Device deltas are SAMPLE seed values (owner: product/seed section). The rule
`{ "kind": "min_selected", "group": "devices", "count": 3 }` fires at EXACTLY 3 selections; with
2 devices the discount line item is absent. This emerges from data -- there is no smart-home code
path.

Response (FROM, handyman): engine runs the same way; the wrapper adds the band and the
confirmation framing flag:

```json
{
  "mode": "FROM",
  "requires_description": false,
  "requires_pro_confirmation": true,
  "from_price": { "amount": 6500, "currency": "USD" },
  "is_from_band": true,
  "displayed_price": {
    "total": { "amount": 9900, "currency": "USD" },
    "subtotal": { "amount": 9900, "currency": "USD" },
    "line_items": [
      { "label": "Base", "amount": { "amount": 0, "currency": "USD" }, "kind": "base" },
      { "label": "TV mounting", "amount": { "amount": 9900, "currency": "USD" }, "kind": "option" }
    ],
    "pricing_version": "apex-pricing.v1",
    "is_estimate": true
  }
}
```

Response (QUOTE, painting): NO engine run, NO price:

```json
{
  "mode": "QUOTE",
  "requires_description": true,
  "requires_pro_confirmation": true,
  "from_price": null,
  "is_from_band": false,
  "displayed_price": null
}
```

Error 422 (unknown selection key -- layer 2):

```json
{
  "success": false,
  "message": "Unknown selection key",
  "errors": { "code": "UNKNOWN_SELECTION_KEY", "key": "bedroms", "known_keys": ["cleaning-type", "bedrooms", "bathrooms", "frequency"] }
}
```

Error 400 (previewing a non-bookable service):

```json
{ "success": false, "message": "Service is not currently bookable", "errors": { "code": "SERVICE_NOT_BOOKABLE", "status": "COMING_SOON" } }
```

### 5.6 POST /bookings -- the Core Flow submit (centerpiece)

One endpoint, full pipeline (see the booking-pipeline section for the transaction internals):
transport validation -> service + config reference validation -> zip gate -> authoritative price
recompute -> booking + configuration snapshot (+ QuoteRequest for QUOTE mode) -> reference from
`BookingReferenceCounter` -> response.

The response `data` is a DISCRIMINATED UNION on `outcome`:

```ts
type CreateBookingResult =
  | { outcome: "BOOKED"; booking_id: string; reference: string; status: "PENDING";
      quote_request: boolean; quote_request_id?: string;
      displayed_price?: DisplayedPriceDto;   // absent for QUOTE bookings
      next: "coordinator_confirms" }
  | { outcome: "WAITLISTED"; waitlist_signup: WaitlistSignupDto };  // NO booking created
```

BOTH arms return HTTP 200 (pinned, foundation-spec section 5).

Why the zip miss is NOT an error: the acceptance criterion says an out-of-area zip must "route to
waitlist capture, never a dead end, never hard-fail". A 4xx here would (a) trip generic client
error handling and retry logic, (b) log a user-caused "failure" for what is a successful lead
capture, and (c) put the discriminated union's two arms on different status codes, forcing the UI
to branch twice (status AND body). The request accomplished its business purpose -- a record was
durably written in both arms -- so both arms are `success: true` and the UI branches on
`data.outcome` alone. `OUT_OF_SERVICE_AREA` deliberately does NOT exist as an error code.

#### (a) PRICED request -- cleaning

```json
POST /api/v1/bookings
{
  "request_id": "9d2e6a1b-7c44-4f0e-8a21-5b3d9c0e7f66",
  "service_type": "cleaning",
  "configuration": {
    "selections": { "cleaning-type": "deep", "bedrooms": "3", "bathrooms": "2", "frequency": "biweekly" },
    "quantity": 1
  },
  "displayed_price": {
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
  },
  "contact": {
    "name": "Jordan Ellis",
    "email": "jordan.ellis@example.com",
    "phone": "+1 919 555 0142",
    "preferred_method": "email",
    "consent_marketing": false
  },
  "address": { "street": "412 Glenwood Ave", "city": "Raleigh", "state": "NC", "zip": "27603" },
  "notes": "Two friendly dogs at home.",
  "source": "WEB"
}
```

`displayed_price` is the client's last preview. The server recomputes from DB rows and compares
totals; the client value is NEVER stored (Elevate rule: client totals are never trusted). The
stored `BookingConfiguration.lineItems`/`priceTotal` snapshot is ALWAYS the server recompute.
`request_id` is the P14-M2 contract's client-generated UUID, persisted to
`Booking.clientRequestId @unique`: a double-submit with the same `request_id` hits the unique
constraint and returns the ORIGINAL booking as a 200 replay instead of minting a duplicate
(mechanism owned by the booking-pipeline section). Optional -- omitting it simply forgoes replay
protection.

#### Success 200 -- BOOKED arm (zip 27603 is in the Wake allowlist)

```json
{
  "success": true,
  "message": "Booking request received",
  "data": {
    "outcome": "BOOKED",
    "booking_id": "b7a1e0c2-4f4e-4d2a-9a3e-6f0d2c9b8a11",
    "reference": "APX-2026-0042",
    "status": "PENDING",
    "quote_request": false,
    "displayed_price": {
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
    },
    "next": "coordinator_confirms"
  }
}
```

The reference comes from the `BookingReferenceCounter` atomic increment inside the booking
transaction. Deviation D-1 (pinned): Elevate generates random `BK-{time36}-{hex}` references;
the PRD mandates sequential, collision-safe `APX-2026-NNNN`.

#### (b) QUOTE request -- painting (`configuration.description`, NO `displayed_price`)

```json
POST /api/v1/bookings
{
  "service_type": "painting",
  "configuration": {
    "selections": {},
    "quantity": 1,
    "description": "Repaint two bedrooms and a hallway, walls and trim, roughly 600 sq ft. Walls are currently dark blue; want a light neutral."
  },
  "contact": { "name": "Priya Nair", "email": "priya.nair@example.com" },
  "address": { "street": "88 Oakwood Ct", "city": "Cary", "state": "NC", "zip": "27513" },
  "source": "WEB"
}
```

#### Success 200 -- BOOKED arm, QUOTE mode

```json
{
  "success": true,
  "message": "Quote request received",
  "data": {
    "outcome": "BOOKED",
    "booking_id": "e4c9d2f1-8b3a-4a67-b1d0-2c8e5f7a9d34",
    "reference": "APX-2026-0043",
    "status": "PENDING",
    "quote_request": true,
    "quote_request_id": "a2f7c4e9-1d5b-4c88-9e12-7b3f6a0d8c55",
    "next": "coordinator_confirms"
  }
}
```

No `displayed_price` key at all: `BookingConfiguration.priceTotal` is NULL for QUOTE bookings by
model design, which structurally enforces "QUOTE bookings NEVER carry a displayed_price". The
pipeline also created the linked `QuoteRequest` row (`source: BOOKING_FLOW`) and returns its id.
The server derived `quote_request: true` from `service.pricingMode`; any client-sent
`quote_request` value was ignored (D6).

#### Success 200 -- WAITLISTED arm (same cleaning body, but zip 27520 = Clayton, outside Wake)

```json
{
  "success": true,
  "message": "That ZIP is outside our current service area. We saved your spot on the waitlist.",
  "data": {
    "outcome": "WAITLISTED",
    "waitlist_signup": {
      "signup_id": "5f2c8a1d-9e47-4b30-a6c2-8d1f3e5b7a90",
      "brand": "apex",
      "email": "jordan.ellis@example.com",
      "zip": "27520",
      "source": "service-area-miss",
      "created_at": "2026-07-06T14:31:22.000Z"
    }
  }
}
```

NO booking row, NO reference consumed, NO price recompute -- the zip gate runs before pricing.
The waitlist write is atomic and idempotent on `[email, zip]`: a repeat submit returns the
existing record in this same shape. The UI can pre-check via `GET /service-area/validate` at the
address step, but this POST-side gate is the source of truth.

#### POST /bookings error examples

422 transport (zod -- malformed zip):

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": {
    "code": "VALIDATION_FAILED",
    "issues": [{ "path": "address.zip", "message": "ZIP must be exactly 5 digits" }]
  }
}
```

422 `PRICE_MISMATCH` (client total disagrees with authoritative recompute -- stale pricing,
tampering, or a client bug; the recomputed price rides along so the UI can refresh Step 3):

```json
{
  "success": false,
  "message": "The displayed price is out of date",
  "errors": {
    "code": "PRICE_MISMATCH",
    "client_total": 19900,
    "server_total": 21250,
    "pricing_version": "apex-pricing.v1",
    "displayed_price": { "total": { "amount": 21250, "currency": "USD" }, "subtotal": { "amount": 25000, "currency": "USD" }, "line_items": ["...server recompute, as in the BOOKED example..."], "pricing_version": "apex-pricing.v1", "is_estimate": true }
  }
}
```

400 `SERVICE_NOT_BOOKABLE` (COMING_SOON or INACTIVE service):

```json
{ "success": false, "message": "Service is not currently bookable", "errors": { "code": "SERVICE_NOT_BOOKABLE", "service": "tree-stump", "status": "COMING_SOON" } }
```

422 `QUOTE_DESCRIPTION_REQUIRED` (QUOTE booking with missing/short description):

```json
{ "success": false, "message": "Please describe the work (at least 10 characters)", "errors": { "code": "QUOTE_DESCRIPTION_REQUIRED", "min_length": 10 } }
```

422 `MISSING_REQUIRED_GROUP` (PRICED payload arriving description-only -- the QUOTE-shaped body
sent at a PRICED service):

```json
{ "success": false, "message": "Missing required selections", "errors": { "code": "MISSING_REQUIRED_GROUP", "missing": ["cleaning-type", "bedrooms", "bathrooms", "frequency"] } }
```

### 5.7 GET /bookings/:reference -- success-page re-read

Anti-enumeration mechanism (pinned): `APX-2026-NNNN` is sequential and therefore guessable, so
the reference alone NEVER unlocks a booking. The caller must supply the matching contact email as
a query param; the success page has it in flow state. Reference-not-found and email-mismatch
return the IDENTICAL 404 body (no oracle about which part failed), and `lookupRateLimiter` caps
guessing throughput.

Request: `GET /api/v1/bookings/APX-2026-0042?email=jordan.ellis%40example.com`

Success 200 (`data`):

```json
{
  "reference": "APX-2026-0042",
  "status": "PENDING",
  "quote_request": false,
  "service": { "name": "Home Cleaning", "slug": "cleaning", "pricingMode": "PRICED" },
  "configuration": {
    "selections": { "cleaning-type": "deep", "bedrooms": "3", "bathrooms": "2", "frequency": "biweekly" },
    "quantity": 1,
    "description": null
  },
  "displayed_price": { "total": { "amount": 21250, "currency": "USD" }, "subtotal": { "amount": 25000, "currency": "USD" }, "line_items": ["...stored server snapshot..."], "pricing_version": "apex-pricing.v1", "is_estimate": true },
  "contact": { "name": "Jordan Ellis", "email": "jordan.ellis@example.com" },
  "address": { "street": "412 Glenwood Ave", "city": "Raleigh", "state": "NC", "zip": "27603" },
  "created_at": "2026-07-06T14:31:22.000Z",
  "next": "coordinator_confirms"
}
```

For a QUOTE booking the same shape carries `quote_request: true`, `configuration.description`,
and omits `displayed_price`.

Error 404 (uniform for unknown reference OR email mismatch):

```json
{ "success": false, "message": "Booking not found", "errors": { "code": "BOOKING_NOT_FOUND" } }
```

Error 422 (missing email param):

```json
{ "success": false, "message": "Validation failed", "errors": { "code": "VALIDATION_FAILED", "issues": [{ "path": "email", "message": "Required" }] } }
```

### 5.8 POST /waitlist

Standalone waitlist capture for the /service-area page (the booking pipeline writes the same
record internally on a zip miss, with `source: "service-area-miss"`).

Request:

```json
POST /api/v1/waitlist
{ "email": "sam.reyes@example.com", "zip": "27520", "source": "service-area-page" }
```

Success 201 (new signup):

```json
{
  "success": true,
  "message": "You're on the waitlist",
  "data": {
    "waitlist_signup": {
      "signup_id": "9d3e6b2a-7c41-4f58-8a90-1e2d4c6b8f07",
      "brand": "apex",
      "email": "sam.reyes@example.com",
      "zip": "27520",
      "source": "service-area-page",
      "created_at": "2026-07-06T15:02:10.000Z"
    },
    "created": true
  }
}
```

Success 200 (duplicate `[email, zip]` -- idempotent, returns the EXISTING record):

```json
{
  "success": true,
  "message": "You're already on the waitlist for this ZIP",
  "data": { "waitlist_signup": { "signup_id": "9d3e6b2a-7c41-4f58-8a90-1e2d4c6b8f07", "brand": "apex", "email": "sam.reyes@example.com", "zip": "27520", "source": "service-area-page", "created_at": "2026-07-06T15:02:10.000Z" }, "created": false }
}
```

Deviation D-5: Elevate's waitlist returns 409 when an ACTIVE entry exists. Apex absorbs the
duplicate idempotently -- the `@@unique([email, zip])` constraint exists precisely "to absorb
double-submits idempotently" (foundation-spec section 2), and a marketing-capture form obeying
"never a dead end" must not punish an eager double click with an error banner. Implementation:
`upsert`-style repository call; `created` distinguishes the arms for analytics stubs.

Error 422 (bad email):

```json
{ "success": false, "message": "Validation failed", "errors": { "code": "VALIDATION_FAILED", "issues": [{ "path": "email", "message": "Enter a valid email" }] } }
```

### 5.9 GET /service-area/validate

Request: `GET /api/v1/service-area/validate?zip=27513`

Success 200 (eligible):

```json
{ "success": true, "message": "Success", "data": { "zip": "27513", "eligible": true, "county": "Wake", "city": "Cary" } }
```

Success 200 (NOT eligible -- still 200, `eligible` is data, not an error; the UI shows the
waitlist prompt):

```json
{ "success": true, "message": "Success", "data": { "zip": "27520", "eligible": false } }
```

Error 422 (malformed zip):

```json
{ "success": false, "message": "Validation failed", "errors": { "code": "VALIDATION_FAILED", "issues": [{ "path": "zip", "message": "ZIP must be exactly 5 digits" }] } }
```

Lookup is against `ServiceAreaZip` rows with `active = true` (seeded from
`prisma/seed-data/service-area.v1.json`, THE shared Raleigh allowlist file Apex owns for future
brands -- consumption notes live in the shared-components section).

### 5.10 GET /service-area/zips

Request: `GET /api/v1/service-area/zips`

Success 200:

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "version": "service-area.v1",
    "county": "Wake",
    "count": 38,
    "zips": [
      { "zip": "27513", "city": "Cary" },
      { "zip": "27601", "city": "Raleigh" },
      { "zip": "27603", "city": "Raleigh" }
    ]
  }
}
```

(Trimmed; returns every `active` row, ordered by zip. No pagination -- one county.) Error case:
none beyond the generic 429/500 family; the endpoint takes no input.

### 5.11 POST /pm-requests

Creates a `QuoteRequest` (`source: PM_FORM`, contact denormalized so the quote stands alone) plus
the 1:1 `PMRequest` extension row ("pm_request extends quote_request", PRD).

Request:

```json
POST /api/v1/pm-requests
{
  "contact": { "name": "Dana Whitfield", "email": "dana@triangleproperties.example.com", "phone": "+1 919 555 0188" },
  "company": "Triangle Properties LLC",
  "units_est": 24,
  "bundle": "turnover",
  "scope_notes": "24 rental units across Raleigh and Cary; need recurring turnover cleans plus occasional junk hauls between tenants."
}
```

`bundle` accepts the wire values `"turnover" | "listing_prep"` and maps to `PMBundle` via
`z.preprocess` (uppercasing), mirroring Elevate's lowercase-brand preprocess precedent. There is
deliberately NO `zip` field -- the PRD pm_request contract is `{ company?, units_est, bundle,
scope_notes }` plus contact, portfolios span zips, and PM requests never touch the zip gate
(coordinator quotes are human-routed).

Success 201:

```json
{
  "success": true,
  "message": "Request received",
  "data": {
    "pm_request_id": "c8b5f2a0-3d17-4e96-b4a8-9f0c1d2e3a46",
    "quote_request_id": "f1e4d7c2-6b90-4a35-8c21-5d8e7f6a9b03",
    "status": "NEW",
    "bundle": "turnover",
    "units_est": 24,
    "next": "coordinator_contacts"
  }
}
```

Error 422 (non-positive units):

```json
{ "success": false, "message": "Validation failed", "errors": { "code": "VALIDATION_FAILED", "issues": [{ "path": "units_est", "message": "Number must be greater than 0" }] } }
```

### 5.12 POST /pro-applications

Request:

```json
POST /api/v1/pro-applications
{
  "name": "Marcus Cole",
  "email": "marcus.cole@example.com",
  "phone": "+1 984 555 0114",
  "zip": "27604",
  "trades": ["pest-control", "cleaning"],
  "acknowledgements": {
    "pest-control": { "nc-pest-license": true },
    "cleaning": { "own-supplies": true }
  },
  "notes": "10 years in pest control, 2-person crew."
}
```

`trades` entries must be known service slugs (min 1, no duplicates); acknowledgement completeness
is checked per-trade against the `TRADE_REQUIREMENTS` map (pest-control = NC pest license,
home-security = NC alarm license, cleaning = own supplies). These are COLLECTED as acknowledged
expectations and NEVER verified -- no license lookup, no document upload; the coordinator reads
them from the record. Trades without an entry in the map (for example `lawn-care`) require no
acknowledgements.

Success 201:

```json
{
  "success": true,
  "message": "Application received",
  "data": {
    "application_id": "d4a7e1b8-5c29-4f63-a0d7-8b3c6e9f2a51",
    "status": "RECEIVED",
    "trades": ["pest-control", "cleaning"],
    "next": "coordinator_contacts"
  }
}
```

Error 422 (required acknowledgement absent or false -- layer 2, stable code):

```json
{
  "success": false,
  "message": "Please acknowledge the requirements for pest-control",
  "errors": { "code": "MISSING_ACKNOWLEDGEMENT", "trade": "pest-control", "key": "nc-pest-license", "label": "I hold a current NC structural pest control license" }
}
```

Error 422 (unknown trade slug -- transport, since the slug list is a static enum):

```json
{ "success": false, "message": "Validation failed", "errors": { "code": "VALIDATION_FAILED", "issues": [{ "path": "trades.0", "message": "Invalid enum value. Expected 'cleaning' | 'lawn-care' | ... , received 'roofing'" }] } }
```

## The three-layer validation model

Pinned in foundation-spec section 6. Layer 1 runs in the `validate({ body, query, params })`
middleware before the controller; layers 2 and 3 run inside module services (they need DB state).
Layer order is strict: a request never reaches price recompute with an unresolvable selection.

| # | Rule | Layer | Enforced in | HTTP | `errors.code` / behavior |
|---|------|-------|-------------|------|--------------------------|
| V1 | Shape, types, enums, email format, zip regex `^\d{5}$`, state literal `"NC"`, string length caps | 1 transport | `validate` middleware + module `*.validation.ts` | 422 | `VALIDATION_FAILED` with `issues[]` |
| V2 | `service_type` / `:idOrSlug` resolves to an existing service | 2 reference | services/bookings service layer | 404 | `SERVICE_NOT_FOUND` |
| V3 | Service is bookable: status is `ACTIVE`; booking or previewing a `COMING_SOON` / `INACTIVE` / `DRAFT` service fails | 2 reference | bookings + config service | 400 | `SERVICE_NOT_BOOKABLE` |
| V4 | Every `selections` key is an ACTIVE config-group key of the service (id-alignment contract) | 2 reference | shared selection validator (configuration section) | 422 | `UNKNOWN_SELECTION_KEY` |
| V5 | Every SELECT/MULTISELECT value resolves to an ACTIVE option key of that group | 2 reference | selection validator | 422 | `UNKNOWN_OPTION_KEY` |
| V6 | Value type matches `inputType`: SELECT = string option key, MULTISELECT = string[], QUANTITY = positive int, TOGGLE = boolean (D7: no number-to-string coercion) | 2 reference | selection validator | 422 | `INVALID_SELECTION_VALUE` |
| V7 | Every `isRequired` ACTIVE group has a selection; catches PRICED/FROM payloads that arrive description-only | 2 reference | selection validator | 422 | `MISSING_REQUIRED_GROUP` with `missing[]` |
| V8 | MULTISELECT bounds: `selectMin <= chosen <= selectMax` when set | 2 reference | selection validator | 422 | `SELECTION_OUT_OF_BOUNDS` |
| V9 | QUOTE service requires `configuration.description`, trimmed length >= 10 | 2 reference | bookings service (needs `pricingMode`) | 422 | `QUOTE_DESCRIPTION_REQUIRED` |
| V10 | QUOTE service must NOT carry `displayed_price` | 2 reference | bookings service | 422 | `QUOTE_PRICE_NOT_ALLOWED` |
| V11 | `quote_request` flag is DERIVED server-side from `service.pricingMode`; the client value is ignored, never an error | 3 business | bookings service | n/a | no failure mode by design (D6) |
| V12 | Zip gate: `address.zip` in the `ServiceAreaZip` allowlist; a miss creates `waitlist_signup` and returns the WAITLISTED arm | 3 business | bookings service | 200 | NOT an error -- `outcome: "WAITLISTED"` (see 5.6) |
| V13 | Authoritative price recompute; client `displayed_price.total` compared for PRICED/FROM; mismatch rejects with the recomputed price in `errors` | 3 business | bookings service via `PricingService` | 422 | `PRICE_MISMATCH` |
| V14 | Discounts (smart-home >= 3 devices, frequency percents) emerge ONLY from `ServicePricingRule` evaluation during recompute; client-asserted discount line items are discarded, never honored | 3 business | pricing module | n/a | folded into V13 -- a client asserting a bogus discount fails the total comparison |
| V15 | Duplicate waitlist `[email, zip]` returns the existing record | 3 business | waitlist service | 200 | NOT an error -- `created: false` (D9) |
| V16 | Pro acknowledgements complete and `true` per `TRADE_REQUIREMENTS`; no ack keys outside the map or outside the applied trades | 2 reference | `validateAcknowledgements` helper called by pro-applications service | 422 | `MISSING_ACKNOWLEDGEMENT` / `UNKNOWN_ACKNOWLEDGEMENT` |
| V17 | `GET /bookings/:reference` requires reference AND email match; uniform miss | 3 business | bookings service | 404 | `BOOKING_NOT_FOUND` (no oracle) |

The layer-2 selection rules (V4-V8) are implemented ONCE in the shared selection validator owned
by the configuration engine (see that section) and reused verbatim by both the price preview and
the booking pipeline, so Step 3 and Step 5 can never disagree about what is valid.

## Zod schema listings

Conventions (Elevate parity): schemas exported by name from `{feature}.validation.ts`; DTOs
derived via `z.infer`; `z.coerce.*` only for query/params; `z.nativeEnum` for Prisma enums;
`z.preprocess` for wire-value mapping (Elevate's lowercase-brand precedent). The `validate`
middleware parses AND REPLACES `req.body/query/params` with the parsed output, so controllers
receive defaulted, typed data; every params schema must list every param on its route.

### 7.1 `src/types/contract.schemas.ts` (shared P14-M2 primitives)

```ts
import { z } from "zod";

/** 5-digit US ZIP. Transport shape only -- allowlist membership is layer-3 business validation. */
export const ZIP_REGEX = /^\d{5}$/;
export const zipSchema = z.string().trim().regex(ZIP_REGEX, "ZIP must be exactly 5 digits");

/** Money in integer minor units (cents). Mirrors the published MoneySchema. */
export const moneySchema = z.object({
  amount: z.number().int(),
  currency: z.string().length(3).default("USD"),
});

export const lineItemSchema = z.object({
  label: z.string(),
  amount: moneySchema,
  kind: z.enum(["base", "modifier", "option", "fee", "discount"]),
});

export const displayedPriceSchema = z.object({
  total: moneySchema,
  subtotal: moneySchema.optional(),
  line_items: z.array(lineItemSchema).default([]),
  pricing_version: z.string(),
  is_estimate: z.boolean().default(true),
});

/** The ConfigValue union -- verbatim from the P14-M2 contract. */
export const configValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
]);

export const selectionsSchema = z.record(z.string(), configValueSchema).default({});

export type Money = z.infer<typeof moneySchema>;
export type LineItem = z.infer<typeof lineItemSchema>;
export type DisplayedPriceDto = z.infer<typeof displayedPriceSchema>;
export type ConfigValue = z.infer<typeof configValueSchema>;
export type Selections = z.infer<typeof selectionsSchema>;
```

### 7.2 `src/modules/bookings/bookings.validation.ts` (complete)

```ts
import { z } from "zod";
import { BookingSource } from "../../enums";
import {
  displayedPriceSchema,
  selectionsSchema,
  zipSchema,
} from "../../types/contract.schemas";

/** APX-YYYY-NNNN; NNNN zero-padded to 4+, so \d{4,}. Brand-parameterized post-MVP. */
export const BOOKING_REFERENCE_REGEX = /^APX-\d{4}-\d{4,}$/;

/** P14-M2 contact block -- contract field names, snake_case on the wire. */
export const contactSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().email("Enter a valid email").max(160),
  phone: z.string().trim().max(40).optional(),
  preferred_method: z.enum(["email", "phone", "sms"]).default("email"),
  consent_marketing: z.boolean().default(false),
});

/** Apex extension of the base contract: structured NC service address.
 * state accepts-and-normalizes: an omitted state defaults to "NC" (the model
 * default); any value other than "NC" is rejected. */
export const addressSchema = z.object({
  street: z.string().trim().min(1, "Street is required").max(200),
  city: z.string().trim().min(1, "City is required").max(120),
  state: z.literal("NC").default("NC"),
  zip: zipSchema,
});

/**
 * configuration block. service_id is intentionally NOT accepted: the server
 * derives the service from service_type and stamps serviceId into the stored
 * snapshot itself. description stays optional at transport -- QUOTE services
 * enforce min 10 chars at layer 2 (V9), where pricingMode is known.
 */
export const bookingConfigurationSchema = z.object({
  selections: selectionsSchema,
  quantity: z.number().int().positive().max(99).default(1),
  // max 2000 matches layer 2's DESCRIPTION_TOO_LONG bound exactly (one bound, one owner:
  // the configuration-engine section), so nothing passes transport only to fail layer 2.
  description: z.string().trim().max(2000).optional(),
});

export const createBookingSchema = z.object({
  /** P14-M2 request_id -> Booking.clientRequestId @unique. Duplicate -> 200 idempotent
   * replay of the original booking (P2002 handling in the pipeline section). */
  request_id: z.string().uuid().optional(),
  /** Service slug, e.g. "cleaning". UUID also accepted by the resolver. */
  service_type: z.string().trim().min(1),
  configuration: bookingConfigurationSchema,
  /** The client's last preview. Compared against the server recompute (V13); never stored. */
  displayed_price: displayedPriceSchema.optional(),
  contact: contactSchema,
  address: addressSchema,
  /** P14-M2 schedule_preferences, accepted as-is and persisted to
   * Booking.schedulePreferences Json? (data-model decision #5). Not interpreted in MVP
   * (no real-time availability); stored so coordinator triage sees the customer's ask. */
  schedule_preferences: z.unknown().optional(),
  notes: z.string().trim().max(2000).optional(),
  /** Accepted for contract compatibility, then IGNORED -- derived from pricingMode (V11). */
  quote_request: z.boolean().optional(),
  source: z.nativeEnum(BookingSource).default(BookingSource.WEB),
});

export const bookingReferenceParamsSchema = z.object({
  reference: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toUpperCase() : v),
    z.string().regex(BOOKING_REFERENCE_REGEX, "Invalid booking reference"),
  ),
});

export const getBookingByReferenceQuerySchema = z.object({
  email: z.string().trim().email("Enter a valid email").max(160),
});

export type ContactDto = z.infer<typeof contactSchema>;
export type AddressDto = z.infer<typeof addressSchema>;
export type BookingConfigurationDto = z.infer<typeof bookingConfigurationSchema>;
export type CreateBookingDto = z.infer<typeof createBookingSchema>;
export type BookingReferenceParamsDto = z.infer<typeof bookingReferenceParamsSchema>;
export type GetBookingByReferenceQueryDto = z.infer<typeof getBookingByReferenceQuerySchema>;
```

Route wiring (for orientation; the module skeleton is in the folder-structure section):

```ts
bookingsRouter.post("/", formRateLimiter, validate({ body: createBookingSchema }),
  asyncHandler(bookingsController.create));
bookingsRouter.get("/:reference", lookupRateLimiter,
  validate({ params: bookingReferenceParamsSchema, query: getBookingByReferenceQuerySchema }),
  asyncHandler(bookingsController.getByReference));
```

### 7.3 `src/modules/services/config/service-config.validation.ts`

```ts
import { z } from "zod";
import { selectionsSchema } from "../../../types/contract.schemas";

/** Body for POST /services/:idOrSlug/config/price. Deviation D-4: keyed selections, not optionIds. */
export const pricePreviewSchema = z.object({
  selections: selectionsSchema,
  quantity: z.number().int().positive().max(99).default(1),
});

export type PricePreviewDto = z.infer<typeof pricePreviewSchema>;
```

### 7.4 `src/modules/services/services.validation.ts`

```ts
import { z } from "zod";
import { ServiceStatus } from "../../enums";

export const idOrSlugParamsSchema = z.object({
  idOrSlug: z.string().trim().min(1),
});

export const listServicesQuerySchema = z.object({
  /** ServiceCategory slug, e.g. "recurring-core". */
  category: z.string().trim().min(1).optional(),
  /** Intersected with PUBLIC_SERVICE_STATUSES in the controller -- see 5.2. */
  status: z.nativeEnum(ServiceStatus).optional(),
});

export type IdOrSlugParamsDto = z.infer<typeof idOrSlugParamsSchema>;
export type ListServicesQueryDto = z.infer<typeof listServicesQuerySchema>;
```

### 7.5 `src/modules/waitlist/waitlist.validation.ts`

```ts
import { z } from "zod";
import { WaitlistSource } from "../../enums";
import { zipSchema } from "../../types/contract.schemas";

/** Wire values are the published kebab-case strings ("service-area-miss"); map to the Prisma enum. */
export const waitlistSourceSchema = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toUpperCase().replace(/-/g, "_") : v),
  z.nativeEnum(WaitlistSource),
);

export const createWaitlistSignupSchema = z.object({
  email: z.string().trim().email("Enter a valid email").max(160),
  zip: zipSchema,
  /** The standalone form defaults to the /service-area page source; the booking
   *  pipeline sets SERVICE_AREA_MISS internally and does not pass through this schema. */
  source: waitlistSourceSchema.default(WaitlistSource.SERVICE_AREA_PAGE),
});

export type CreateWaitlistSignupDto = z.infer<typeof createWaitlistSignupSchema>;
```

### 7.6 `src/modules/service-area/service-area.validation.ts`

```ts
import { z } from "zod";
import { zipSchema } from "../../types/contract.schemas";

export const validateZipQuerySchema = z.object({
  zip: zipSchema,
});

export type ValidateZipQueryDto = z.infer<typeof validateZipQuerySchema>;
```

### 7.7 `src/modules/pm-requests/pm-requests.validation.ts`

```ts
import { z } from "zod";
import { PMBundle } from "../../enums";
import { zipSchema } from "../../types/contract.schemas";
import { contactSchema } from "../bookings/bookings.validation";

/** Wire values "turnover" | "listing_prep" map onto PMBundle (Elevate preprocess precedent). */
export const pmBundleSchema = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toUpperCase() : v),
  z.nativeEnum(PMBundle),
);

export const createPmRequestSchema = z.object({
  contact: contactSchema,
  company: z.string().trim().max(160).optional(),
  units_est: z.number().int().positive().max(10000),
  bundle: pmBundleSchema,
  scope_notes: z.string().trim().min(10, "Tell us a bit more about the scope").max(4000),
  // NO zip field: the PRD pm_request contract is { company?, units_est, bundle, scope_notes }
  // + contact, and the data model has no column for it. Portfolio zips belong in scope_notes;
  // a structured field is a post-MVP schema addition (see open questions).
});

export type CreatePmRequestDto = z.infer<typeof createPmRequestSchema>;
```

### 7.8 `src/modules/pro-applications/pro-applications.validation.ts`

```ts
import { z } from "zod";
import { zipSchema } from "../../types/contract.schemas";

/**
 * The 11 bookable trades (PRD-pinned slugs). Static because the slugs are
 * PRD-published identifiers; the seed catalog MUST match. Post-MVP, if admin
 * can create services, replace with a layer-2 DB check (code UNKNOWN_TRADE).
 */
export const SERVICE_SLUGS = [
  "cleaning", "lawn-care", "junk-removal", "pool", "pest-control", "smart-home",
  "power-washing", "handyman", "painting", "home-security", "tree-stump",
] as const;

export type ServiceSlug = (typeof SERVICE_SLUGS)[number];

/**
 * Per-trade requirement acknowledgements. COLLECTED as pro-acknowledged
 * expectations, NEVER verified (no license lookup, no uploads) -- PRD rule.
 * Trades absent from this map require no acknowledgements.
 */
export const TRADE_REQUIREMENTS: Partial<
  Record<ServiceSlug, ReadonlyArray<{ key: string; label: string }>>
> = {
  "pest-control": [
    { key: "nc-pest-license", label: "I hold a current NC structural pest control license" },
  ],
  "home-security": [
    { key: "nc-alarm-license", label: "I hold a current NC alarm systems (ASLB) license" },
  ],
  cleaning: [
    { key: "own-supplies", label: "I bring my own cleaning supplies and equipment" },
  ],
};

export const createProApplicationSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().email("Enter a valid email").max(160),
  phone: z.string().trim().max(40).optional(),
  zip: zipSchema,
  trades: z
    .array(z.enum(SERVICE_SLUGS))
    .min(1, "Pick at least one trade")
    .max(SERVICE_SLUGS.length)
    .refine((trades) => new Set(trades).size === trades.length, "Duplicate trades"),
  /** Shape only at transport: Record<tradeSlug, Record<ackKey, boolean>>.
   *  Completeness runs at layer 2 via validateAcknowledgements (V16). */
  acknowledgements: z.record(z.string(), z.record(z.string(), z.boolean())).default({}),
  notes: z.string().trim().max(2000).optional(),
});

export type CreateProApplicationDto = z.infer<typeof createProApplicationSchema>;

export interface AcknowledgementViolation {
  code: "MISSING_ACKNOWLEDGEMENT" | "UNKNOWN_ACKNOWLEDGEMENT";
  trade: string;
  key: string;
  label?: string;
}

/**
 * Layer-2 completeness check, called by pro-applications.service so failures
 * carry stable codes instead of generic VALIDATION_FAILED issues. Returns the
 * first violation, or null when clean. Rules:
 *  - ack entries must belong to an applied-for trade and a known requirement key;
 *  - every requirement of every applied-for trade must be present AND true.
 */
export function validateAcknowledgements(
  dto: CreateProApplicationDto,
): AcknowledgementViolation | null {
  const applied = new Set<string>(dto.trades);
  for (const [trade, acks] of Object.entries(dto.acknowledgements)) {
    if (!applied.has(trade)) {
      return { code: "UNKNOWN_ACKNOWLEDGEMENT", trade, key: "*" };
    }
    const known = new Set(
      (TRADE_REQUIREMENTS[trade as ServiceSlug] ?? []).map((r) => r.key),
    );
    for (const key of Object.keys(acks)) {
      if (!known.has(key)) return { code: "UNKNOWN_ACKNOWLEDGEMENT", trade, key };
    }
  }
  for (const trade of dto.trades) {
    for (const req of TRADE_REQUIREMENTS[trade] ?? []) {
      if (dto.acknowledgements[trade]?.[req.key] !== true) {
        return { code: "MISSING_ACKNOWLEDGEMENT", trade, key: req.key, label: req.label };
      }
    }
  }
  return null;
}
```

The service layer converts a violation to
`ApiError.unprocessable(message, { code, trade, key, label })`. Requiring `=== true` means an
applicant cannot submit while declining an expectation; whether a `false` acknowledgement should
instead be stored for coordinator follow-up is an open product question (see below).

### 7.9 `src/middleware/validate.ts` (Elevate port with one change)

Ported verbatim from Elevate (parse-and-replace `req.body/query/params`; ZodError -> 422) except
the details payload is wrapped for the stable-code contract:

```ts
if (err instanceof ZodError) {
  const issues = err.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
  return next(
    ApiError.unprocessable("Validation failed", { code: "VALIDATION_FAILED", issues }),
  );
}
```

The global error handler's own ZodError branch (for schemas parsed outside the middleware) wraps
identically, so `errors.code` is ALWAYS present on 4xx responses. This is Deviation D-6.

## Error-code catalog

Stable machine-readable strings carried in `errors.code` (the serialized `ApiError.details`).
Clients branch on these, never on `message` text. Adding a code is additive-safe; renaming one is
a breaking change.

| Code | HTTP | Factory | Raised by | Meaning / extra `errors` fields |
|---|---|---|---|---|
| `VALIDATION_FAILED` | 422 | `ApiError.unprocessable` | `validate` middleware, error handler | Zod shape failure; `issues: [{ path, message }]` |
| `SERVICE_NOT_FOUND` | 404 | `ApiError.notFound` | services, config, preview, bookings | `:idOrSlug` / `service_type` resolved nothing; `idOrSlug` |
| `SERVICE_NOT_BOOKABLE` | 400 | `ApiError.badRequest` | preview, bookings | Service exists but status is not ACTIVE; `status` |
| `UNKNOWN_SELECTION_KEY` | 422 | `ApiError.unprocessable` | selection validator (V4) | `key`, `known_keys[]` |
| `UNKNOWN_OPTION_KEY` | 422 | `ApiError.unprocessable` | selection validator (V5) | `group`, `value`, `known_options[]` |
| `INVALID_SELECTION_VALUE` | 422 | `ApiError.unprocessable` | selection validator (V6) | `group`, `expected` (e.g. "string option key"), `received` |
| `MISSING_REQUIRED_GROUP` | 422 | `ApiError.unprocessable` | selection validator (V7) | `missing[]`; also the answer to PRICED description-only payloads |
| `SELECTION_OUT_OF_BOUNDS` | 422 | `ApiError.unprocessable` | selection validator (V8) | `group`, `min`, `max`, `count` |
| `QUOTE_DESCRIPTION_REQUIRED` | 422 | `ApiError.unprocessable` | bookings service (V9) | `min_length: 10` |
| `DESCRIPTION_TOO_LONG` | 422 | `ApiError.unprocessable` | selection validator | QUOTE description over 2000 chars (trimmed); `max_length: 2000` |
| `DESCRIPTION_NOT_ALLOWED` | 422 | `ApiError.unprocessable` | selection validator | `configuration.description` sent on a PRICED/FROM booking (free text belongs in `notes`; the "description iff QUOTE" invariant, configuration-engine section 6) |
| `TEXTAREA_IN_SELECTIONS` | 422 | `ApiError.unprocessable` | selection validator | A `selections` key resolved to a TEXTAREA group; the value belongs in `configuration.description`; `group` |
| `QUOTE_PRICE_NOT_ALLOWED` | 422 | `ApiError.unprocessable` | bookings service (V10) | QUOTE booking arrived with `displayed_price` |
| `PRICE_MISMATCH` | 422 | `ApiError.unprocessable` | bookings service (V13) | `client_total`, `server_total`, `pricing_version`, recomputed `displayed_price` |
| `BOOKING_NOT_FOUND` | 404 | `ApiError.notFound` | booking lookup (V17) | Uniform for bad reference OR email mismatch -- no extra fields, deliberately |
| `MISSING_ACKNOWLEDGEMENT` | 422 | `ApiError.unprocessable` | pro-applications service (V16) | `trade`, `key`, `label` |
| `UNKNOWN_ACKNOWLEDGEMENT` | 422 | `ApiError.unprocessable` | pro-applications service (V16) | `trade`, `key` |
| `RATE_LIMITED` | 429 | limiter handler (envelope emitted directly) | all limiters | Retry later |
| `DB_UNAVAILABLE` | 503 | health controller | `/health` | `db: "down"` |

Factory-signature note (flagged to the folder-structure section's `utils/api-error.ts`): the
verbatim Elevate `ApiError.notFound(message)` and `badRequest(message)` factories take no details
argument. Apex extends every factory to `(message, details?)` so 404/400 codes
(`SERVICE_NOT_FOUND`, `BOOKING_NOT_FOUND`, `SERVICE_NOT_BOOKABLE`) can carry `errors.code` like
every other operational 4xx. One-line signature change, behavior otherwise identical -- recorded
as part of Deviation D-6's "errors.code always present" guarantee.

Deliberate NON-codes:

- There is NO `OUT_OF_SERVICE_AREA` code. A zip miss is the 200 WAITLISTED success arm (V12),
  never an error.
- Duplicate waitlist signups produce NO error (V15); Prisma `P2002` on `[email, zip]` is handled
  inside the waitlist service before it could reach the generic 409 translation.
- 500s carry no `errors.code` (non-operational; `stack` only outside production).

## Deviations from Elevate (summary for this section)

| # | Deviation | Justification |
|---|-----------|---------------|
| D-1 | Booking reference `APX-YYYY-NNNN` via `BookingReferenceCounter` instead of random `BK-{time36}-{hex}` | PRD-mandated format; sequential and collision-safe under the booking transaction. (Pinned deviation 1.) Side effect handled here: sequential references are enumerable, hence the email-match lookup guard (D3, V17). |
| D-2 | Server-side pricing engine port (base x quantity -> modifiers -> conditional rules -> fees) instead of Elevate's additive `base + sum(optionModifier)` | Matrix, percent-discount, and threshold pricing cannot be expressed additively; the server recompute is the integrity guard behind `PRICE_MISMATCH`. (Pinned deviation 2.) |
| D-3 | All MVP endpoints PUBLIC; Elevate's `/bookings` sits behind `authenticate` | No customer accounts in the PRD; contact is snapshotted per booking; abuse control via `formRateLimiter`/`lookupRateLimiter`. Auth middleware scaffolded for the post-MVP admin surface only. (Pinned deviation 3.) |
| D-4 | Preview body `{ selections, quantity }` instead of `{ optionIds: string[] }` | Keyed selections per the P14-M2 contract are required for matrix/quantity/toggle semantics. (Pinned deviation 4.) |
| D-5 | Waitlist duplicate returns idempotent 200 with the existing record; Elevate returns 409 for an existing ACTIVE entry | Foundation-pinned `@@unique([email, zip])` exists to absorb double-submits idempotently; a "never a dead end" marketing capture must not error on an eager double click. |
| D-6 | Zod failure details wrapped as `{ code: "VALIDATION_FAILED", issues }`; Elevate emits the bare issues array | Guarantees `errors.code` on every 4xx so the anonymous booking UI branches on one stable field; issue objects themselves are unchanged. |
| D-7 | `POST /bookings` returns 200 on success; Elevate creates with 201 | The response is a discriminated union whose WAITLISTED arm does not create the requested resource; a single 200 keeps both arms symmetric and the UI branching on `data.outcome` only (foundation-spec section 5 pins 200 for both arms). Other creates (`/waitlist` new, `/pm-requests`, `/pro-applications`) keep Elevate's 201. |
| D-8 | `RATE_LIMIT_MAX` default 300 (Elevate ships 100) | Anonymous configurator traffic fires a preview per selection change; same env keys, tunable per deployment. |

## Open questions (product owner)

1. Frequency discount percentages (weekly 20 / biweekly 15 / monthly 10 / one-time 0) and the
   smart-home per-device prices are SAMPLE seed values -- confirm real numbers before launch.
   Owner: product; blocked work: `apex-pricing.v1.json` seed values only (no code change).
2. Pro applications: must every requirement acknowledgement be `true` to submit (current design),
   or should `false` be storable so a coordinator can follow up? One-line change in
   `validateAcknowledgements` either way.
3. `GET /bookings/:reference` returns the full address snapshot after the email match. Confirm
   this is acceptable, or whether street should be redacted on re-read.
4. PM requests carry no structured `zip`/location field (portfolio location lives in
   `scope_notes`) -- confirm, or a column + schema field is a small post-MVP addition.
5. `schedule_preferences` is stored verbatim (D8) but never rendered anywhere in MVP -- confirm
   the coordinator triage view (post-MVP admin) is the intended first consumer.
