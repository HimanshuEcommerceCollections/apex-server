# Booking pipeline, shared components, development roadmap

This section covers deliverables 8, 9, and 10 of the Apex Total Home Services backend design:
the end-to-end booking pipeline behind `POST /api/v1/bookings`, the inventory of components that
future Raleigh brands reuse, and the backend-first build order with per-phase verification that
requires no frontend.

Inputs this section assumes you have read (do not duplicate; cross-reference):

- `context-prd.md` -- PRD, business rules, verified Elevate contracts (scratchpad context set).
- `foundation-spec.md` -- pinned model/enum/endpoint names and the four approved deviations.
- `elevate-conventions.md` -- verified Elevate server conventions (ground truth for "mirror Elevate").
- Companion section files in this directory (`server/docs/architecture/`): the folder-structure
  section (deliverable 1), the Prisma schema section (deliverable 2), the pricing engine and
  strategy sections (deliverables 3 and 7), the configuration engine section (deliverable 4), and
  the API + validation sections (deliverables 5 and 6). Where this file shows request bodies, zod
  behavior, or schema fields, the owning section is authoritative for the full listing; this file
  pins only what the pipeline itself introduces.

All money in this document is integer cents (`Int` minor units). All endpoints live under
`/api/v1` and use the `{success, message, data, meta?}` envelope.

## Deliverable 8 -- the booking pipeline (`POST /api/v1/bookings`)

The pipeline is the Core Flow submit: one public, rate-limited endpoint that either creates a
Booking (with its immutable configuration snapshot, and a QuoteRequest record when the service is
QUOTE mode) or -- on a service-area miss -- captures a WaitlistSignup and creates no booking at
all. Deviation: anonymous public `POST /bookings` (Elevate guards its bookings router with
`authenticate`) -- justified by the PRD's explicit "no customer accounts" scope; contact details
are snapshotted per booking and the endpoint is rate-limited (pinned deviation 3 in
`foundation-spec.md`).

### End-to-end sequence

1. **Request.** `POST /api/v1/bookings` with the booking-request body (authoritative zod schema in
   the API/validation sections). Body carries `request_id` (uuid, optional -- see Idempotency),
   `service_type` (slug), `configuration` (`{selections, quantity, description?}` -- the published
   contract's `configuration.service_id` is intentionally NOT accepted; the server derives the
   service from `service_type`, per the API section),
   optional `displayed_price` client echo, `contact`, `address{street, city, state:"NC", zip}`,
   `notes?`. `quote_request` is NEVER read from the client; it is derived from
   `service.pricingMode` server-side.
2. **Transport validation.** `generalRateLimiter` (plus the stricter per-form limiter defined in
   the API section) then `validate({ body: createBookingSchema })`. Zod enforces shape, email
   format, zip regex `^\d{5}$`, `quantity` int >= 1, selections as
   `Record<string, string|number|boolean|string[]>`. Failure -> 422 with per-field details;
   nothing else runs.
3. **Service + config resolution.** Load `Service` by slug or id; must exist (404) and be
   `ACTIVE` (400 "This service is not currently bookable" -- Elevate wording). Load its ACTIVE
   `ServiceConfigGroup`s with ACTIVE `ServiceConfigOption`s and its `ServicePricingRule` rows in
   one query. These reads happen OUTSIDE the write transaction (see Transaction boundary).
4. **Selection validation.** `validateSelections({ pricingMode, groups, selections, quantity,
   description })` (the pure shared validator -- signature and violation semantics owned by the
   configuration-engine section 8.1): id-alignment resolution (`selections[group.key] ->
   option.key`), required groups present, MULTISELECT within `selectMin`/`selectMax`, QUOTE mode
   requires `configuration.description` of at least 10 chars, PRICED/FROM reject description-only
   payloads that are missing required groups. Any violation -> 422 carrying
   `{ code, groupKey?, message }` details; nothing written.
5. **Zip gate fork.** `isZipEligible(dto.address.zip)` checks the `ServiceAreaZip` allowlist
   (active rows only).
   - **Miss -> waitlist arm.** Upsert `WaitlistSignup{ email, zip, source: SERVICE_AREA_MISS }`
     (single atomic statement riding the `@@unique([email, zip])` constraint -- no transaction
     needed and NO booking, no reference, no counter touch). Record a best-effort demo-inbox
     entry. Respond `200 { outcome: "WAITLISTED", waitlist_signup }`. This is a success response,
     never a 4xx: the PRD's "never a dead end" rule is enforced server-side (pinned in
     `foundation-spec.md` section 5).
   - **Pass -> continue** to pricing.
6. **Pricing recompute (mode-aware).** `pricingService.recomputeForBooking(idOrSlug,
   input, clientPrice)` -- the entry point pinned by the pricing-engine section 6.4; it re-loads
   the pricing view of the service via `pricingRepository.findServiceForPricing` (one indexed
   read; a pre-loaded-context overload is a possible later optimization, not MVP) and dispatches
   through the same `PricingModeHandler` registry the preview endpoint uses:
   - PRICED / FROM: run the engine (base x quantity -> modifiers -> conditional rules -> fees)
     and produce `displayed_price` with line items. If the client echoed a `displayed_price`,
     compare totals; mismatch -> 422 `PRICE_MISMATCH` with the recomputed price in `details`.
     Client totals are compared but never trusted. Deviation: full engine port server-side
     (Elevate's server does additive `base + sum(optionModifier)` only) -- justified because
     matrix, percent-discount, and threshold pricing cannot be expressed additively and the
     server recompute is the integrity guard (pinned deviation 2).
   - QUOTE: no engine run; `displayed_price` stays `null` end to end; `BookingConfiguration.priceTotal`
     persists as NULL, which structurally enforces "QUOTE bookings never carry a displayed_price".
7. **Reference generation.** Inside the write transaction: `nextBookingReference(tx, "APX")`
   upsert-increments `BookingReferenceCounter` for `(brandCode, year)` and formats
   `APX-${year}-${String(n).padStart(4, "0")}`. Full listing and concurrency analysis below.
   Deviation: counter-backed `APX-YYYY-NNNN` instead of Elevate's random
   `BK-{time36}-{hex}` -- justified because the PRD mandates the sequential Apex format (pinned
   deviation 1).
8. **Transactional persistence.** One `prisma.$transaction` containing ONLY writes: counter
   upsert-increment, `Booking` create with nested `BookingConfiguration` create, and a nested
   `QuoteRequest` create when `pricingMode === QUOTE` (with denormalized contact fields and
   `source: BOOKING_FLOW`). Commit publishes the reference.
9. **Demo-inbox stub notification.** AFTER commit, outside the transaction:
   `demoInboxService.record(FormKind.BOOKING, booking.id, payload)` writes a `FormSubmissionLog`
   row (the "demo inbox" -- no real email/SMS, per PRD scope). Best-effort: a failure here is
   logged at warn level and never fails the request.
10. **Response.** `200 { outcome: "BOOKED", reference, booking_id, status: "PENDING",
    displayed_price?, next: "coordinator_confirms" }` (QUOTE bookings omit `displayed_price`).
    The success page can re-read via `GET /bookings/:reference` (guarded by reference + email
    match per the API section, to prevent enumeration).

Response status decision:

| Outcome | Status | Rationale |
|---|---|---|
| BOOKED | 200 OK | Pinned by the API section (D2/D-7, citing foundation-spec section 5): the response is a discriminated union and BOTH arms return 200, so the UI branches on `data.outcome` alone. Deviation from Elevate's 201-on-create, recorded in the API section; the other creates (`/waitlist` new, `/pm-requests`, `/pro-applications`) keep 201 |
| WAITLISTED | 200 OK | Same union; a successful flow outcome whose created resource is a signup, not the requested booking |
| Idempotent replay (duplicate `request_id`) | 200 OK | Nothing new was created; the original booking is returned |

### ASCII sequence diagram

```
client                router + middleware        bookings.service                          postgres
  |                          |                          |                                      |
  |-- POST /api/v1/bookings->|                          |                                      |
  |                          |-- rate limiters          |   (429 -> failure envelope, stop)    |
  |                          |-- validate({body}) ----->|   (422 -> zod details, stop)         |
  |                          |                          |                                      |
  |                          |   [1] resolve service + groups + options + rules -------------->|  SELECTs (reads only)
  |                          |                          |<-------------------------------------|
  |                          |   [2] validateSelections(config, dto)          (pure, in-proc)  |
  |                          |   [3] zip gate: isZipEligible(address.zip) --------------------->|  SELECT ServiceAreaZip
  |                          |                          |<-------------------------------------|
  |                          |        +-----------------+--------------------+                 |
  |                          |        | MISS: waitlist arm (NO booking,      |                 |
  |                          |        |       NO counter, NO transaction)    |                 |
  |                          |        |  upsert WaitlistSignup ------------- + --------------->|  INSERT .. ON CONFLICT (email,zip)
  |                          |        |  demoInbox.record (best effort) ---- + --------------->|  INSERT FormSubmissionLog
  |<-- 200 {outcome:"WAITLISTED", waitlist_signup} -----+                    |                 |
  |                          |        +-----------------+--------------------+                 |
  |                          |   [4] PASS: pricingService.recomputeForBooking (mode-aware)
  |                          |   [5] client-total mismatch check (422 PRICE_MISMATCH, stop)    |
  |                          |   [6] $transaction ------------------------------------------- >|  BEGIN
  |                          |         nextBookingReference(tx, "APX") ---------------------- >|  INSERT counter ON CONFLICT
  |                          |                          |                                      |    DO UPDATE counter = counter + 1
  |                          |                          |                                      |    (row lock held until COMMIT)
  |                          |         tx.booking.create( reference,                           |
  |                          |           nested BookingConfiguration,                          |
  |                          |           nested QuoteRequest when mode = QUOTE ) ------------ >|  INSERTs
  |                          |       COMMIT ------------------------------------------------- >|  COMMIT (lock released,
  |                          |                          |                                      |   reference published)
  |                          |   [7] demoInbox.record(BOOKING, ...)  (post-commit) ---------- >|  INSERT FormSubmissionLog
  |<-- 200 {outcome:"BOOKED", reference, booking_id, status, displayed_price?, next} ----------|
```

### The exact `$transaction` boundary

Per Elevate layering, the repository is the only layer that touches `prisma.*`, so the
transaction lives in `bookings.repository.ts`; the service does all reading, validating, and
pricing first and hands the repository a fully-resolved write payload.

| Work | Inside tx? | Why |
|---|---|---|
| Service / config / rules reads | No | Read-only against seed-owned data (seed is the only writer in MVP); holding them in the tx would only lengthen the counter lock window |
| Selection validation, pricing recompute, mismatch check | No | Pure in-process computation; deterministic given the reads above |
| Zip allowlist check | No | Read-only; the fork decision happens before any write |
| WaitlistSignup upsert (miss arm) | No (own single statement) | One atomic `INSERT .. ON CONFLICT` is already all-or-nothing; the waitlist arm creates NO booking, so there is no multi-row invariant to protect |
| BookingReferenceCounter upsert-increment | **Yes** | The reference must roll back if the booking insert fails; this is what makes "duplicates never" hold |
| Booking create (+ nested BookingConfiguration, + nested QuoteRequest when QUOTE) | **Yes** | The atomic unit: a booking without its configuration snapshot, or a QUOTE booking without its quote_request record, must be impossible |
| Demo-inbox `FormSubmissionLog` write | No (post-commit) | Best-effort stub by design; its failure must not roll back a real booking, and its success must not be blocked on the counter lock |
| Response serialization | No | After commit; see failure table for the "committed but client saw 500" window |

Pipeline core (annotated sketch; DTO and serialization details belong to the API section):

```ts
// src/modules/bookings/bookings.repository.ts (the ONLY layer touching prisma.*)
import { prisma } from "../../db/client";
import { BRAND_CODE } from "../../constants";
import { nextBookingReference } from "./booking-reference";
import { withRetryOnWriteConflict } from "../../utils/tx-retry";
import { Brand, BookingSource, BookingStatus, PricingMode } from "../../enums";

export class BookingsRepository {
  /** The whole booked-arm write set. Everything in here commits or rolls back together. */
  createBooked(input: BookedCreateInput) {
    return withRetryOnWriteConflict(() =>
      prisma.$transaction(
        async (tx) => {
          const reference = await nextBookingReference(tx, BRAND_CODE); // APX-2026-NNNN
          return tx.booking.create({
            data: {
              reference,
              clientRequestId: input.clientRequestId ?? null, // idempotency (see below)
              serviceId: input.serviceId,
              status: BookingStatus.PENDING,
              quoteRequest: input.pricingMode === PricingMode.QUOTE, // derived, never client-sent
              contactName: input.contact.name,
              contactEmail: input.contact.email,
              contactPhone: input.contact.phone ?? null,
              addressStreet: input.address.street,
              addressCity: input.address.city,
              addressState: input.address.state, // "NC"
              addressZip: input.address.zip,
              notes: input.notes ?? null,
              brand: Brand.APEX,
              source: BookingSource.WEB,
              configuration: {
                create: {
                  serviceId: input.serviceId,
                  selections: input.selections,          // immutable snapshot
                  quantity: input.quantity,
                  description: input.description ?? null, // QUOTE text
                  priceTotal: input.priced?.total.amount ?? null,     // NULL for QUOTE
                  priceSubtotal: input.priced?.subtotal?.amount ?? null,
                  lineItems: input.priced?.line_items ?? undefined,   // LineItem[] snapshot
                  pricingVersion: input.priced?.pricing_version ?? null,
                  isEstimate: true,
                },
              },
              ...(input.pricingMode === PricingMode.QUOTE
                ? {
                    // relation field name `quote` per the schema section (the pinned
                    // Boolean column owns `quoteRequest`)
                    quote: {
                      create: {
                        serviceId: input.serviceId,
                        description: input.description!,
                        source: "BOOKING_FLOW",
                        contactName: input.contact.name,
                        contactEmail: input.contact.email,
                        contactPhone: input.contact.phone ?? null,
                      },
                    },
                  }
                : {}),
            },
            include: { configuration: true, quote: true },
          });
        },
        { timeout: 5000 }, // default ReadCommitted isolation; correctness rests on the
      ),                   // counter row lock, not on a stricter isolation level
    );
  }
}
```

Storage side of the idempotency key: `Booking.clientRequestId String? @unique` -- already
shipped in the schema section's Prisma listing (decision #5 there); no addendum needed.

### Reference generator -- full listing

Location: `src/modules/bookings/booking-reference.ts`. Brand-code parameterized (nothing Apex-
specific inside the file), transaction-client parameterized (it never opens its own transaction;
it MUST run inside the caller's).

```ts
// src/modules/bookings/booking-reference.ts
// Shared cross-brand component (see Deliverable 9): imports nothing from other modules,
// config, or constants. Brand specifics arrive as parameters.
import type { Prisma } from "@prisma/client";

export interface ReferenceParts {
  brandCode: string; // "APX" for Apex; e.g. "ELV" for a future Elevate adoption
  year: number;      // UTC year at assignment time
  counter: number;   // 1-based, per (brandCode, year)
}

/** APX-2026-0042. padStart never truncates: counter 10000 renders APX-2026-10000. */
export function formatBookingReference({ brandCode, year, counter }: ReferenceParts): string {
  return `${brandCode}-${year}-${String(counter).padStart(4, "0")}`;
}

/**
 * Allocate the next reference for a brand+year. MUST be called with the SAME
 * Prisma.TransactionClient that writes the Booking row, so the increment commits
 * and rolls back atomically with the booking itself.
 *
 * The upsert compiles to a single native statement on PostgreSQL
 * (INSERT .. ON CONFLICT ("brandCode","year") DO UPDATE SET counter = counter + 1),
 * because the where targets one compound unique and there are no nested writes.
 */
export async function nextBookingReference(
  tx: Prisma.TransactionClient,
  brandCode: string,
  now: Date = new Date(),
): Promise<string> {
  const year = now.getUTCFullYear();
  const row = await tx.bookingReferenceCounter.upsert({
    where: { brandCode_year: { brandCode, year } },
    create: { brandCode, year, counter: 1 },
    update: { counter: { increment: 1 } },
    select: { counter: true },
  });
  return formatBookingReference({ brandCode, year, counter: row.counter });
}
```

Concurrency analysis:

- **Why the row lock serializes.** The `ON CONFLICT .. DO UPDATE` takes a row-level exclusive
  lock on the `(brandCode, year)` counter row. Because the call runs inside the booking's
  interactive transaction, that lock is held until COMMIT/ROLLBACK. A concurrent booking
  transaction blocks at its own upsert until the first transaction finishes, then reads the
  committed counter and increments it. Number assignment is therefore strictly serialized in
  lock-acquisition order: two transactions can never observe the same counter value, so
  duplicates are impossible by construction. Default ReadCommitted isolation is sufficient --
  the guarantee comes from the write lock, not from snapshot isolation, so no Serializable
  overhead and no serialization-failure retries in the common path.
- **First booking of a year.** Two transactions racing to CREATE the row for a new year: the
  native `INSERT .. ON CONFLICT` handles this atomically in one statement -- the loser of the
  insert race falls through to the `DO UPDATE` arm. If a future Prisma version ever falls back
  to its non-native read-then-write upsert emulation, the loser surfaces `P2002`, which the
  single-retry policy below absorbs; `Booking.reference @unique` remains the terminal backstop.
- **Rollback.** If anything later in the transaction fails (booking insert error, timeout), the
  counter increment rolls back with it and the lock releases. A queued transaction then
  re-executes its upsert against the pre-rollback value -- it receives the number the failed
  transaction would have used. Net effect: this design produces no gaps from rollbacks in
  practice, but the contract only promises "sequential and collision-safe"; gaps (from manual
  counter edits, future migration to native sequences, or year rollover resets) are acceptable,
  duplicates never. `Booking.reference @unique` turns any hypothetical duplicate into a 409
  instead of silent corruption.
- **Retry.** `withRetryOnWriteConflict` (`src/utils/tx-retry.ts`) retries the whole transaction
  callback exactly once on Prisma `P2034` (write conflict/deadlock), then rethrows. The retried
  attempt allocates a fresh number via a fresh upsert; the aborted attempt's increment never
  committed, so numbering stays contiguous. No other error is retried -- the transaction body is
  deterministic given its inputs, so a second failure means a real fault (surface it as 500).
- **Lock window.** The counter lock is held for the remainder of the transaction (booking +
  configuration + quote inserts), serializing concurrent bookings across a few milliseconds.
  At demo scale this is a non-issue; if it ever matters, the escape hatch is moving the counter
  allocation to a Postgres sequence per brand-year (accepting rollback gaps), which the
  "gaps acceptable" contract already permits.
- **Year boundary.** The year comes from the server clock (UTC) at allocation time. Two requests
  straddling midnight Dec 31 get different `(brandCode, year)` rows -- both valid, no collision,
  and the new year restarts at `APX-2027-0001` automatically via the upsert's create arm.

### Failure-handling table

"Rolled back?" describes database side effects at the moment the client receives the status.

| # | Pipeline step | Failure | Status + error | Side effects rolled back / absent? |
|---|---|---|---|---|
| 1 | Rate limit | Too many requests | 429, failure envelope | Nothing written |
| 2 | Transport validation | Malformed body / bad types / bad zip format | 422 "Validation failed" + per-field details | Nothing written |
| 3 | Service resolution | Unknown slug/id | 404 "Service not found" | Nothing written |
| 3 | Service resolution | Service not ACTIVE | 400 "This service is not currently bookable" | Nothing written |
| 4 | Selection validation | Unknown group/option key (id-alignment miss) | 422, details path `configuration.selections.<key>` | Nothing written |
| 4 | Selection validation | Missing required group; MULTISELECT out of bounds | 422 with details | Nothing written |
| 4 | Selection validation | QUOTE without `configuration.description` (>= 10 chars) | 422 | Nothing written |
| 5 | Zip gate | Out-of-area zip | NOT a failure: 200 `{outcome:"WAITLISTED"}` | WaitlistSignup upserted (intended); NO booking, NO counter touch |
| 5 | Zip gate | DB error during allowlist read or waitlist upsert | 500 | Nothing partial -- the upsert is a single atomic statement |
| 6 | Pricing recompute | Client total != recomputed total | 422 `PRICE_MISMATCH`, recomputed `displayed_price` in details | Nothing written |
| 6 | Pricing recompute | Rules-evaluator internal error (malformed rule row) | 500 | Nothing written; seed bug -- caught by Phase 6 id-alignment audit |
| 7-8 | Transaction | Write conflict / deadlock (`P2034`) | Retried once, then 500 | Fully rolled back: no booking, no counter increment, no quote record |
| 7-8 | Transaction | Transaction timeout (`P2028`, > 5000 ms) | 500 | Fully rolled back |
| 7-8 | Transaction | `P2002` on `Booking.reference` (backstop; unreachable if the lock analysis holds) | 409 via global handler | Fully rolled back |
| 7-8 | Transaction | `P2002` on `Booking.clientRequestId` (double submit race) | 200 idempotent replay: existing booking re-read and returned | New attempt fully rolled back; original booking untouched |
| 9 | Demo-inbox stub | `FormSubmissionLog` insert fails | Request still succeeds (200) | Booking committed; miss is logged at warn -- the stub is best-effort by design |
| 10 | Response serialization | Bug after commit | 500 to the client, booking EXISTS | Not rolled back. This is the one "committed but client saw an error" window; a client retry with the same `request_id` replays to 200 with the committed booking (this window is why the idempotency key exists) |

### Idempotency

**Waitlist arm: idempotent by construction.** `WaitlistSignup @@unique([email, zip])` plus
upsert semantics: a double submit (or a re-submit weeks later) lands on the same row and returns
the same `waitlist_signup`, 200 both times. No error surface for the user, which also honors
"never a dead end". (Elevate's waitlist answers a duplicate ACTIVE join with 409; Apex's
anonymous zip-miss capture deliberately absorbs instead -- the pinned `@@unique([email, zip])`
in `foundation-spec.md` exists precisely for this.)

**Booking arm: decision.**

| Option | Mechanism | Verdict |
|---|---|---|
| (a) Client idempotency key | Persist a client-generated uuid unique per submission; replay returns the original booking | **Chosen** -- the P14-M2 booking_request contract already carries `request_id (uuid)`, so no new wire field is invented; the anonymous public endpoint has no auth identity to dedupe on, and the post-commit 500 window plus double-click double-submits are real |
| (b) Accept duplicates | Every submit is a new booking | Rejected as the primary policy, but retained as the documented fallback when `request_id` is absent (curl, older clients): no payments exist, a coordinator triages the inbox, and duplicate PENDING bookings are visible and cheap to cancel at demo scale |
| (c) Heuristic dedupe (same email + service + selections within N minutes) | Fuzzy window match | Rejected: false positives (a customer legitimately booking two identical cleanings for two properties) and nondeterministic behavior under test |

Pinned mechanics:

- Wire: optional body field `request_id` (uuid) -- straight from the P14-M2 contract; the client
  generates it when the confirm step mounts, so a double-click or a retry after a network error
  reuses the same value. No custom header.
- Storage: `Booking.clientRequestId String? @unique` (schema addendum flagged above).
- Behavior: the create runs optimistically; on `P2002` against `clientRequestId` the service
  fetches the existing booking by `clientRequestId` and returns it as a 200 replay with the
  original `reference`. No pre-read in the happy path (the unique index does the work, and a
  pre-read could not close the race anyway).

```ts
// src/modules/bookings/bookings.service.ts (replay handling, excerpt)
try {
  booking = await bookingsRepository.createBooked(input);
} catch (err) {
  if (isUniqueViolation(err, "clientRequestId") && input.clientRequestId) {
    const existing = await bookingsRepository.findByClientRequestId(input.clientRequestId);
    if (existing) return this.serializeBooked(existing, { replayed: true }); // 200, same reference
  }
  throw err;
}
```

Deviation: `Booking.clientRequestId` idempotency replay (Elevate has no idempotency key on
bookings) -- justified by the anonymous public endpoint (no authenticated identity to dedupe
on) and by the contract already defining `request_id`; Elevate's authenticated flow can afford
duplicates because staff see them attached to one account.

## Deliverable 9 -- shared cross-brand components

Apex is the second Raleigh brand on this architecture and deliberately deposits reusable parts
for brand #3. The presentation decision:

| Option | Verdict |
|---|---|
| Clearly-bounded component directories scattered across `modules/` | Rejected: splitting shared code across module homes blurs the boundary, and the folder-structure section (which owns the tree) pins a dedicated `src/shared/` |
| **A dedicated `src/shared/` tree (per `01-foundations.md`), plus the engine at its pinned `modules/pricing/engine/` path under the same import rule** | **Chosen**: `shared/contracts/`, `shared/reference/`, `shared/service-area/` sit next to `modules/`; each is self-contained, so extraction to a workspace package later is `git mv` plus import rewrites. The engine core stays at the foundation-pinned `modules/pricing/engine/` but obeys the identical boundary |

**The extraction rule (pinned; owned by `01-foundations.md`, restated here).** `src/shared/`
(and `modules/pricing/engine/`) may import ONLY: other files in the same boundary, Node
builtins, and `zod`. NEVER from `modules/`, `db/`, `config/`, `constants/`, `middleware/`,
`utils/`, or `enums/` -- and in particular never `@prisma/client` types or enums, which encode
the Apex schema. Shared types are standalone literal unions; module services own the
Prisma-enum-to-wire mapping. Shared code never throws `ApiError`; it returns result objects the
module layer translates. Anything that genuinely needs a Prisma transaction client (the counter
increment) therefore lives module-side (`modules/bookings/booking-reference.ts`) and calls the
pure shared part. Brand specifics -- brand code, pricing tables, allowlist file paths -- enter
as function parameters or data arguments, never as imports. Phase 6 adds an automated check
(`eslint no-restricted-imports` per boundary, or `dependency-cruiser`) so the rule cannot rot
silently. The extraction test: any shared folder must be copyable into brand #3's repo, or an
npm workspace package (working name `@raleigh-brands/core` -- a proposal, not a pinned name),
with zero edits.

### Inventory

| Component | Lives at | What it is | Zero-Apex-imports boundary |
|---|---|---|---|
| Pricing engine core + rules evaluator | `src/modules/pricing/engine/` (`types.ts`, `money.ts`, `compute-price.ts`, `evaluate-rules.ts` -- layout owned by the pricing-engine section) | Verbatim port of the Elevate client engine (`Client/src/lib/pricing/engine.ts`) plus the Apex conditional-rules pass (deliverable 3 section) | Pure `(PricingTable, Configuration) -> DisplayedPrice`; no Prisma, no HTTP, no brand constants; pricing data is an argument |
| Configuration contract types + selection validator | `src/shared/contracts/` (`booking-contract.types.ts`, `selection.validator.ts`) | The P14-M2 wire types (Configuration, Money, LineItem, DisplayedPrice) and the pure selection validator (semantics owned by the configuration-engine section 8.1) | Validator takes structural inputs (`ConfigGroupLike[]`), not Prisma models; returns violations, never throws HTTP errors |
| Booking reference generator | `src/shared/reference/reference-generator.ts` (pure formatter) + `src/modules/bookings/booking-reference.ts` (the tx-side counter adapter) | Pure `formatBookingReference(brandCode, year, seq) -> "APX-2026-0042"`; the module-side adapter does the counter upsert-increment against a `Prisma.TransactionClient` and calls the formatter | The shared half imports nothing but stdlib; the Prisma-touching half deliberately lives module-side per the import rule |
| Zip validator + allowlist loader | `src/shared/service-area/` (`zip.validator.ts`, `allowlist-loader.ts`) + `prisma/seed-data/service-area.v1.json` | THE shared Raleigh service-area file (Apex owns it) plus the loader that parses/validates it and the pure eligibility check | Loader is pure file-shape parsing (zod); the validator is pure `(zip, allowlist) -> boolean` -- the DB-backed lookup wraps it in `modules/service-area`; the JSON file itself is the shared artifact |
| Waitlist module | `src/modules/waitlist/` | The zip-miss capture pattern: upsert-on-`[email, zip]`, brand-tagged signup records | A clearly-bounded module rather than a shared lib (per `01-foundations.md`); the `brand` column keeps records multi-brand; Express layer stays module-local |
| Envelope / error / validate utilities | `src/utils/api-error.ts`, `src/utils/api-response.ts`, `src/utils/async-handler.ts`, `src/middleware/validate.ts` | The Elevate-parity HTTP toolkit: `ApiError` factories, `sendSuccess`/`buildMeta`, zod `validate({body,query,params})` | Already brand-free in Elevate; Apex keeps them at Elevate-parity paths (pinned tree) with the same zero-brand-import discipline -- extraction-ready verbatim |

### Per-component notes

**Pricing engine core + rules evaluator** (`src/modules/pricing/engine/`).
Steps 1-2 (base x quantity, modifiers) are bit-for-bit Elevate-compatible; the rules pass adds
`min_selected` / `option_selected` triggers producing standard `fee|discount` line items with fee
rounding (`Math.round(subtotal * value / 100)`). How brand #3 consumes this: copy (or import,
post-extraction) the directory unchanged; author its own `pricing.v1.json`-shaped table and rule
rows; run the Phase 3 parity fixtures (same input -> same `DisplayedPrice`) against the Elevate
client engine to prove nothing drifted. A brand with no threshold pricing simply seeds zero rule
rows -- the pass is a no-op.

**Configuration contract types + selection validator** (`src/shared/contracts/`).
`booking-contract.types.ts` is the single TS mirror of the published P14-M2 contract
(12-field booking_request, `Configuration`, `Money`, `LineItem`); `selection.validator.ts`
enforces id-alignment, required groups, and bounds against structural `ConfigGroupLike[]`
inputs. The signature and violation vocabulary are owned by the configuration-engine section
8.1 -- quoted here verbatim:

```ts
export type SelectionValue = string | number | boolean | string[];

export interface SelectionViolation {
  code: SelectionViolationCode;   // 05's error-code catalog vocabulary
  groupKey?: string;
  message: string;
}

export function validateSelections(input: {
  pricingMode: "PRICED" | "FROM" | "QUOTE";  // standalone literal union, not the Prisma enum
  groups: ConfigGroupLike[];                 // ACTIVE groups with ACTIVE options, ordered
  selections: Record<string, SelectionValue>;
  quantity: number;
  description?: string | null;
}):
  | { ok: true; normalized: { selections: Record<string, SelectionValue>; quantity: number; description: string | null } }
  | { ok: false; violations: SelectionViolation[] };
```

How brand #3 consumes this: import the types and validator as-is; map its own Prisma config rows
to `ConfigGroupLike[]` (a five-line select). Because the validator returns violations rather
than throwing `ApiError`, any HTTP layer (or a CLI seed linter) can wrap it.

**Booking reference generator** (`src/shared/reference/reference-generator.ts` +
`src/modules/bookings/booking-reference.ts`).
The shared half is the pure formatter `formatBookingReference(brandCode, year, seq)`; the
module half owns the `BookingReferenceCounter` upsert-increment inside the booking transaction
(full listing above) because it needs `Prisma.TransactionClient`, which the shared import rule
forbids. How brand #3 consumes this: copy the formatter unchanged; add the
`BookingReferenceCounter` model fragment (`brandCode`, `year`, `counter`,
`@@unique([brandCode, year])`) to its schema; write its own ten-line tx adapter calling
`formatBookingReference(..., "ELV", ...)`. The counter table is brand-keyed, so multiple brands
could even share one database without renumbering each other.

**Zip validator + allowlist loader** (`src/shared/service-area/`).
`service-area.v1.json` is THE shared Raleigh file and Apex owns it -- other brands consume it,
they do not fork it. File shape OWNED by the data-model section 6.1 (deactivation is derived
from absence: a zip removed from the file is set `active: false` at seed time, never deleted):

```json
{
  "version": "service-area.v1",
  "owner_brand": "apex",
  "region": "Wake County, NC",
  "zips": [
    { "zip": "27601", "city": "Raleigh", "county": "Wake" },
    { "zip": "27513", "city": "Cary", "county": "Wake" },
    { "zip": "27587", "city": "Wake Forest", "county": "Wake" }
  ]
}
```

`allowlist-loader.ts` exports `loadServiceAreaFile(path)` (zod-validates the shape; used by
`seed.ts` to populate `ServiceAreaZip`) and `zip.validator.ts` exports `normalizeZip(input)`
(trim, 5-digit check) plus the pure `isZipInAllowlist(zip, allowlist)`. The DB-backed runtime
check (`isZipEligible` querying active `ServiceAreaZip` rows) lives in
`modules/service-area/service-area.service.ts`, wrapping the pure validator per the import
rule. How brand #3 consumes this: vendor the same JSON file at seed time (single source of
truth stays in the Apex repo until the shared package exists), run the same loader in its seed,
reuse both pure functions unchanged -- eligibility semantics stay identical across brands,
which is the point of a shared Raleigh service area.

**Waitlist module** (`src/modules/waitlist/`).
The Express routes/controller stay brand-local; the shared core is
`waitlist-capture.ts#captureWaitlistSignup({ db, brand, email, zip, source })` -- the upsert
that makes double submits idempotent and tags rows with the brand. The Apex booking pipeline and
`POST /waitlist` both call it. How brand #3 consumes this: reuse the `WaitlistSignup` model
fragment (with its `brand` column and `@@unique([email, zip])` -- note a multi-brand shared
database would widen this to `@@unique([brand, email, zip])`, a decision for the extraction
moment), pass its own `Brand` enum value, and mount its own thin routes.

**Envelope / error / validate utilities** (`src/utils/*`, `src/middleware/validate.ts`).
Verbatim Elevate ports: `ApiError` static factories, the global error handler translations
(ZodError -> 422 details, P2002 -> 409, P2025 -> 404), `sendSuccess`, `buildPagination`/`buildMeta`,
`asyncHandler`, `validate({body,query,params})` with in-place `req` mutation. How brand #3
consumes this: copy verbatim (today) or import from the extracted package (later). These files
take no brand parameters at all -- they are the strongest candidates to extract first, and any
fix made here should be back-ported to Elevate to keep the family identical.

## Deliverable 10 -- development order

Backend-first, dependency-ordered, verifiable at every phase with curl (or a REST-client file)
and unit tests -- no frontend required anywhere. Each phase ends with a working, demonstrable
increment and retires a specific UI-integration risk, so when the Next.js pages swap their
hardcoded data for the API, the swap is mechanical.

Test runner decision: **vitest** (devDependency + `"test": "vitest run"` script). Elevate's
conventions document no test setup, so this is an addition rather than a deviation; the cleaning
matrix and exactly-3-devices acceptance criteria are unit-test-shaped, and vitest runs TS
natively alongside `tsx`. (If the team standardizes on another runner, only Phase 3's file
headers change.)

### Phase 0 -- scaffold (walking skeleton)

- **Tasks:** `npm init` as `apex-server` with the pinned dependency set and scripts
  (`foundation-spec.md` section 0); `tsconfig.json`; the pinned folder tree; `src/config/env.ts`
  (zod-validated env); `src/db/client.ts` (cached PrismaClient); `src/utils/` (api-error,
  api-response, async-handler, pagination) and `src/middleware/` (validate, error-handler,
  not-found, rate-limit) as verbatim Elevate ports; `src/app.ts` with the exact Elevate wiring
  order (helmet -> cors -> json -> rate limit -> `/api/v1` router -> notFound -> errorHandler);
  `src/server.ts`; `modules/health`; `.env.example`.
- **Files touched:** everything above plus `src/routes/index.ts`, `src/constants/index.ts`
  (`BRAND_CODE = "APX"`, `PRICING_VERSION`), `src/utils/tx-retry.ts` (stub).
- **Depends on:** nothing (PostgreSQL instance + `DATABASE_URL`).
- **Verify without a frontend:**
  ```bash
  npm run dev
  curl -s http://localhost:4000/api/v1/health
  # -> {"success":true,"message":"Success","data":{"status":"ok","db":"ok"}}
  curl -s http://localhost:4000/api/v1/nope   # -> 404 failure envelope
  ```
  Assert the failure envelope is `{success:false, message, ...}` and 422/404/500 translations
  match `elevate-conventions.md`.
- **UI risk retired:** the envelope and error shapes are frozen on day one -- the client team
  can write its fetch wrapper against `/health` before any feature exists.

### Phase 1 -- schema + seed (the data is the product)

- **Tasks:** author `prisma/schema.prisma` in full (schema section, deliverable 2 -- including
  the `Booking.clientRequestId` addendum from this file); first migration; `src/enums/index.ts`
  re-export; `prisma/seed.ts` + `prisma/seed-data/apex-catalog.json` (11 services, categories,
  groups, options, rules), `apex-pricing.v1.json`, `service-area.v1.json`; make the seed
  idempotent (upsert by slug/key) so re-runs are safe.
- **Files touched:** `prisma/*`, `src/enums/index.ts`.
- **Depends on:** Phase 0.
- **Verify without a frontend:**
  ```bash
  npx prisma migrate dev && npm run prisma:seed && npm run prisma:seed  # second run must no-op
  psql "$DATABASE_URL" -c 'SELECT "pricingMode", count(*) FROM "Service" GROUP BY 1;'
  # -> PRICED 6 / FROM 2 / QUOTE 3   (the pinned mode split, as DATA)
  psql "$DATABASE_URL" -c 'SELECT count(*) FROM "ServiceAreaZip" WHERE active;'
  ```
  Also run a parity diff of seed values against the frontend's local data
  (`client/src/data/HouseCleaningData/configuratorData.ts` -> 9500/14500/19500, 2500/bed,
  1500/bath; `LawnCareData/sizeSelectorData.ts` -> 4500/6500/9000/13000) -- a throwaway script
  is fine; Phase 6 formalizes it.
- **UI risk retired:** the catalog the UI will render is real and matches the numbers already
  shipped in the hardcoded pages -- no "the API says $95, the page says $145" surprises later.

### Phase 2 -- catalog + config reads

- **Tasks:** `modules/services` (`GET /services` with category/status filters,
  `GET /services/:idOrSlug`) and the nested `config/` sub-module
  (`GET /services/:idOrSlug/config` returning service + ordered groups + options + pricing mode +
  rules summary -- the single round-trip configurator payload). `Router({ mergeParams: true })`
  per Elevate.
- **Files touched:** `src/modules/services/**` (routes/controller/service/repository/validation/
  types + `config/` sub-module), `src/routes/index.ts`.
- **Depends on:** Phase 1 (seeded data).
- **Verify without a frontend:**
  ```bash
  curl -s localhost:4000/api/v1/services | jq '.data | length'          # -> 11
  curl -s localhost:4000/api/v1/services/cleaning/config | jq '{
    mode: .data.pricingMode,
    groups: [.data.configGroups[] | {key, inputType, options: (.options | length)}] }'
  # -> SELECT groups for cleaning-type/bedrooms/bathrooms/frequency, sortOrder-stable
  curl -s localhost:4000/api/v1/services/painting/config | jq .data.pricingMode  # -> "QUOTE"
  ```
  Assert group/option ordering is stable across calls (sortOrder, not insertion luck).
- **UI risk retired:** every configurator (matrix, tiers, load estimator, device checklist,
  textarea) renders from ONE endpoint's payload -- the UI team can delete hardcoded data files
  and drive all five built pages from `GET .../config`.

### Phase 3 -- pricing engine (pure, unit-testable FIRST -- no HTTP needed)

- **Tasks:** port `compute-price.ts` verbatim; write `evaluate-rules.ts` (the conditional-rules
  pass); the three `PricingModeHandler`s + `PricingService` (`preview` for HTTP,
  `recomputeForBooking` for the pipeline -- same registry); the DB-row ->
  `ServicePricingData` mapper. Write the tests BEFORE wiring any route -- the engine takes
  plain objects, so nothing here needs Express or even a database (fixtures are built from
  `apex-pricing.v1.json`). Then wire `POST /services/:idOrSlug/config/price`.
  Deviation (pinned 4): the preview body is `{ selections, quantity? }`, not Elevate's
  `{ optionIds }` -- justified by the P14-M2 keyed-selections contract, required for
  matrix/quantity semantics.
- **Files touched:** `src/modules/pricing/**` (engine/, handlers, service, mapper, __tests__),
  `src/modules/services/config/*` (preview route additions), `src/modules/services/config/selection-validator.ts`.
- **Depends on:** Phase 1 (seed values to mirror in fixtures); independent of Phase 2 (pure code
  first is the point).
- **Verify without a frontend:** unit tests first --
  ```ts
  // src/modules/pricing/__tests__/cleaning-matrix.test.ts -- ALL 240 combinations
  const TYPE_BASE = { standard: 9500, deep: 14500, "move-in-out": 19500 } as const;
  const FREQ_PCT = { "one-time": 0, monthly: 10, biweekly: 15, weekly: 20 } as const; // SAMPLE seed
  for (const type of Object.keys(TYPE_BASE)) 
    for (let beds = 1; beds <= 5; beds++)
      for (let baths = 1; baths <= 4; baths++)
        for (const freq of Object.keys(FREQ_PCT))
          it(`${type} ${beds}bd ${baths}ba ${freq}`, () => {
            const subtotal = TYPE_BASE[type] + beds * 2500 + baths * 1500;
            const expected = subtotal - Math.round((subtotal * FREQ_PCT[freq]) / 100);
            const out = computePrice(cleaningTable, { service_id: "cleaning", quantity: 1,
              selections: { "cleaning-type": type, bedrooms: String(beds),
                            bathrooms: String(baths), frequency: freq } });
            expect(out.total.amount).toBe(expected);
          });

  // smart-home-threshold.test.ts -- the exactly-3-devices edge
  it("2 devices -> NO discount line item", ...);
  it("3 devices -> exactly one 15% discount, Math.round(sum * 15 / 100)", ...);
  it("4 devices -> discount present, still one line item, recomputed on the larger sum", ...);
  ```
  plus lawn tiers (4 cases), junk loads (4), FROM band shape, QUOTE returns `mode:"QUOTE"` with
  `displayed_price: null`, and Elevate-parity fixtures (same input through the ported engine and
  the published `Client/src/lib/pricing/engine.ts` semantics -> identical `DisplayedPrice`).
  Then over HTTP:
  ```bash
  curl -s -X POST localhost:4000/api/v1/services/cleaning/config/price \
    -H 'content-type: application/json' \
    -d '{"selections":{"cleaning-type":"deep","bedrooms":"3","bathrooms":"2","frequency":"biweekly"},"quantity":1}' \
    | jq .data.displayed_price.total
  # -> {"amount":21250,"currency":"USD"}   (25000 subtotal - 3750 biweekly discount)
  ```
  (Group/option keys shown are SAMPLE pending the seed catalog -- reconcile with the schema/seed
  section before freezing fixtures; owner: schema section author.)
- **UI risk retired:** the highest-risk math in the product (Step 3 live pricing, the two
  acceptance-criteria edges) is PROVEN before any UI exists; the price preview the UI calls is
  the same code path the booking pipeline will trust.

### Phase 4 -- booking pipeline

- **Tasks:** `modules/service-area` (`GET /service-area/validate?zip=`, `GET /service-area/zips`,
  and the internal `isZipEligible`); `modules/waitlist` capture core; `modules/bookings`
  (validation, service pipeline as specified in Deliverable 8, repository transaction,
  `booking-reference.ts`, `GET /bookings/:reference` with reference + email guard);
  `modules/quotes` reads; `modules/demo-inbox` (routeless internal module -- Elevate
  `notifications` precedent -- writing `FormSubmissionLog`); `withRetryOnWriteConflict`.
- **Files touched:** `src/modules/{service-area,waitlist,bookings,quotes,demo-inbox}/**`,
  `src/utils/tx-retry.ts`, `src/routes/index.ts`.
- **Depends on:** Phases 1-3 (Phase 2's config reads are used by the pipeline's resolution step).
- **Verify without a frontend:**
  ```bash
  # BOOKED arm (PRICED)
  curl -s -X POST localhost:4000/api/v1/bookings -H 'content-type: application/json' -d '{
    "request_id":"7f0d2b6e-1c3a-4e5f-9a8b-0c1d2e3f4a5b",
    "service_type":"cleaning",
    "configuration":{"quantity":1,
      "selections":{"cleaning-type":"deep","bedrooms":"3","bathrooms":"2","frequency":"biweekly"}},
    "contact":{"name":"Jane Doe","email":"jane@example.com"},
    "address":{"street":"12 Oak St","city":"Raleigh","state":"NC","zip":"27601"}}' | jq .data
  # -> {"outcome":"BOOKED","reference":"APX-2026-0001","status":"PENDING",
  #     "displayed_price":{"total":{"amount":21250,...},...},"next":"coordinator_confirms"}

  # replay: SAME request_id -> 200, SAME reference, no second booking
  # WAITLISTED arm: same body with "zip":"10001" -> 200 {"outcome":"WAITLISTED",...}; then:
  psql "$DATABASE_URL" -c 'SELECT count(*) FROM "Booking";'            # unchanged by the miss
  psql "$DATABASE_URL" -c 'SELECT email, zip, source FROM "WaitlistSignup";'

  # QUOTE arm (painting): configuration.description >= 10 chars, no displayed_price in
  # request or response; then assert the QuoteRequest row exists and priceTotal IS NULL:
  psql "$DATABASE_URL" -c 'SELECT b.reference, bc."priceTotal", q.status
    FROM "Booking" b JOIN "BookingConfiguration" bc ON bc."bookingId" = b.id
    LEFT JOIN "QuoteRequest" q ON q."bookingId" = b.id WHERE b."quoteRequest";'

  # PRICE_MISMATCH: echo a wrong displayed_price total -> 422 with recomputed price in details
  # Reference concurrency: 20 parallel submits (omit request_id so none collapse), then prove
  # zero duplicates and a contiguous counter:
  seq 1 20 | xargs -P 10 -I{} curl -s -X POST localhost:4000/api/v1/bookings \
    -H 'content-type: application/json' -d @booking-no-reqid.json -o /dev/null
  psql "$DATABASE_URL" -c 'SELECT count(*) total, count(DISTINCT reference) distinct_refs
    FROM "Booking";'   # total == distinct_refs
  psql "$DATABASE_URL" -c 'SELECT counter FROM "BookingReferenceCounter"
    WHERE "brandCode" = '"'"'APX'"'"';'  # == number of booked-arm bookings this year
  ```
- **UI risk retired:** the entire Core Flow contract -- both discriminated-union arms, the QUOTE
  shape, the success-page re-read -- is exercised end to end; the confirm/success steps of the
  UI bind to verified responses.

### Phase 5 -- secondary forms

- **Tasks:** `modules/waitlist` public `POST /waitlist` (`{email, zip, source}`, idempotent via
  the same capture core; `source: SERVICE_AREA_PAGE` for the standalone page);
  `modules/pm-requests` (`POST /pm-requests` -> `$transaction` creating
  `QuoteRequest(source: PM_FORM)` + `PMRequest{quoteRequestId, company?, unitsEst, bundle,
  scopeNotes}` -- "pm_request extends quote_request" as rows, mirroring the pipeline's
  transactional pattern); `modules/pro-applications` (`POST /pro-applications` with trades
  multi-select validated against service slugs and `acknowledgements` stored as collected --
  never verified). All three record to the demo inbox post-commit.
- **Files touched:** `src/modules/{waitlist,pm-requests,pro-applications}/**`.
- **Depends on:** Phase 4 (demo-inbox module, capture core, envelope habits).
- **Verify without a frontend:**
  ```bash
  curl -s -X POST localhost:4000/api/v1/waitlist -H 'content-type: application/json' \
    -d '{"email":"a@b.com","zip":"10001","source":"SERVICE_AREA_PAGE"}'   # run twice -> same signup
  curl -s -X POST localhost:4000/api/v1/pm-requests -H 'content-type: application/json' \
    -d '{"contact":{"name":"PM Co","email":"pm@co.com"},"company":"PM Co","units_est":12,
         "bundle":"TURNOVER","scope_notes":"12 units quarterly turnover"}'
  psql "$DATABASE_URL" -c 'SELECT q.source, p."unitsEst", p.bundle FROM "PMRequest" p
    JOIN "QuoteRequest" q ON q.id = p."quoteRequestId";'
  curl -s -X POST localhost:4000/api/v1/pro-applications -H 'content-type: application/json' \
    -d '{"name":"Sam Pro","email":"sam@pro.com","zip":"27601",
         "trades":["pest-control","cleaning"],
         "acknowledgements":{"pest-control":{"nc-pest-license":true},"cleaning":{"own-supplies":true}}}'
  ```
- **UI risk retired:** every remaining PRD form has a real endpoint and a demo-inbox record;
  the /service-area page, PM page, and Pro page bind to verified contracts.

### Phase 6 -- hardening + parity checks

- **Tasks:** stricter per-form rate limits (API section values); CORS from env; error-path
  conformance tests (422 zod details shape, P2002 -> 409, P2025 -> 404 -- exactly the
  `elevate-conventions.md` translations); **id-alignment audit script** (`scripts/audit-alignment.ts`:
  every `ServiceConfigGroup.key` <-> `apex-pricing.v1.json` modifier id, every option key <->
  option id, every rule's `trigger.group` resolves -- run in CI and after every seed change);
  frontend-parity snapshot (seeded prices vs `client/src/data/**` figures); import-boundary lint
  for the Deliverable 9 components; seed re-run idempotency in CI; transaction failure-injection
  tests (force an insert error after the counter upsert; assert no booking, no counter drift);
  `README.md` + `.env.example` finalization; optional post-MVP `GET /demo-inbox` admin read
  behind the scaffolded auth middleware (MVP verification uses Prisma Studio / psql -- decision
  recorded below).
- **Files touched:** `scripts/*`, test files across modules, `.eslintrc`/`dependency-cruiser`
  config, `README.md`.
- **Depends on:** Phases 0-5.
- **Verify without a frontend:** `npm run test` green (matrix 240 + threshold + parity +
  failure-injection suites); audit script exits 0; a scripted smoke run of every endpoint via a
  REST-client file (`docs/rest/apex.http`) checked into the repo.
- **UI risk retired:** drift risk -- seed edits, key renames, or convention regressions are
  caught by CI instead of by the UI team at integration time.

Demo-inbox surface decision:

| Option | Verdict |
|---|---|
| `FormSubmissionLog` table + Prisma Studio/psql for demo viewing | **Chosen for MVP** -- zero extra surface area; the PRD only requires "records + demo inbox", not a UI |
| `GET /demo-inbox` read endpoint | Deferred to Phase 6 optional / post-MVP behind the scaffolded auth middleware |

`FormSubmissionLog` (shape OWNED by the data-model section, which ships it):
`id (uuid)`, `kind FormKind`, `entityId String?` (booking/signup/request id), `payload Json`,
`createdAt` -- with `enum FormKind { BOOKING QUOTE PM_REQUEST PRO_APPLICATION WAITLIST }`.
The pipeline writes `BOOKING` for every booking; when the booking nests a `QuoteRequest` (QUOTE
mode) or the PM form creates one, a second `QUOTE` entry logs it under the quote's own id, so
the demo inbox shows quote work distinctly. Writes are always post-commit and best-effort.

### Definition of done -- PRD acceptance criteria mapped to backend artifacts

Criteria as enumerated in `context-prd.md` ("Non-negotiable business rules" plus the three
data-contract criteria); if the source PRD numbers them differently, remap labels only -- the
artifacts stand.

| # | Acceptance criterion | Backend artifact that satisfies it | Phase | Frontend-owned remainder |
|---|---|---|---|---|
| 1 | 11 services split 6 PRICED / 2 FROM / 3 QUOTE; modes are data, not code | `Service.pricingMode` seeded from `apex-catalog.json`; the mode-split SQL check; `PricingModeHandler` registry means reassignment is a seed change | 1, 3 | None |
| 2 | Cleaning matrix math correct at EVERY beds x baths x type x frequency combination | The 240-combination unit suite (`cleaning-matrix.test.ts`) against the seeded table; the same engine runs preview and booking recompute | 3 | Displaying the price (UI) |
| 3 | Smart-home discount at EXACTLY 3 devices (2 -> none, 3 -> 15%) | `ServicePricingRule` `min_selected{group:"devices",count:3}` row + `smart-home-threshold.test.ts` edge suite; discount emerges from rules, never client-asserted | 1, 3 | None |
| 4 | Zip pass -> booking proceeds; miss -> waitlist_signup, never a dead end | The zip-gate fork: 200 `{outcome:"WAITLISTED"}` with atomic signup upsert and NO booking; `GET /service-area/validate` for the UI pre-check | 4 | Rendering the waitlist arm as a friendly step (UI routing) |
| 5 | QUOTE bookings never carry displayed_price; carry configuration.description; produce quote_request records | QUOTE handler returns `displayed_price: null`; `BookingConfiguration.priceTotal` NULL for QUOTE; nested `QuoteRequest(source: BOOKING_FLOW)` inside the booking transaction; 422 when description < 10 chars | 3, 4 | "Custom estimate" copy (UI) |
| 6 | Booking references APX-2026-NNNN, sequential, collision-safe | `booking-reference.ts` counter upsert inside the transaction; `Booking.reference @unique` backstop; the 20-parallel-submit concurrency check | 4 | Showing the reference on the success page (UI) |
| 7 | All money integer cents; server recomputes at booking creation; client totals never trusted | `Int` cents everywhere in schema; mandatory `recomputeForBooking` recompute; 422 `PRICE_MISMATCH` with recomputed price; mismatch test in Phase 4 | 1, 3, 4 | Formatting cents to dollars (UI) |
| 8 | pm_request extends quote_request `{company?, units_est, bundle, scope_notes}`; forms are stubs -> records + demo inbox | `POST /pm-requests` transaction creating `QuoteRequest` + `PMRequest(quoteRequestId)`; every form writes `FormSubmissionLog`; no real notifications anywhere | 5 | PM page form UX |
| 9 | Pro application: trades multi-select + zip + per-trade acknowledgements collected as expectations, NEVER verified | `POST /pro-applications` storing `trades String[]` (validated against service slugs) and `acknowledgements Json` verbatim; no verification code path exists by design | 5 | Requirement-expectation copy per trade (UI) |

Out-of-scope confirmations (no backend artifact by design): payments, customer auth, real
notifications, availability, license verification -- per `context-prd.md`. Analytics events are
client-side stubs; the backend's contribution is stable identifiers (service slugs, `outcome`
values, the reference format), all pinned above.
