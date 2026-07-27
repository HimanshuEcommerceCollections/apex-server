# Platform evolution: accounts, auth, RBAC, payments, admin-controlled catalog, API-driven client

Section 07 of the Apex Total Home Services backend architecture. This is the design blueprint for
five capabilities the MVP blueprint (01–06) deliberately **deferred or excluded**:

1. **API-controlled client** — the Next.js client stops shipping hardcoded `src/data` prices and is
   driven by the backend API.
2. **Authentication** — accounts for customers and staff.
3. **Authorization** — capability-based RBAC (customer / coordinator / admin).
4. **Stripe payments** — one-time booking charges + recurring membership subscriptions.
5. **Admin-controlled pricing & configuration** — the seed-only catalog becomes an audited,
   versioned, admin-editable surface.

> **Framing — this is a blueprint amendment, not a live migration.** `server/` today is docs only
> (no code, no schema deployed). So these changes are integrated into the design *before first
> build*; the "additive/nullable only" discipline from 02 applies to changes made *after* launch,
> not to this pre-build amendment. The only code that migrates is the **client** (which is real).

## 0. Relationship to 01–06 and what this reverses

This section **adds strictly alongside** the pinned surface — it never renames or repurposes an
existing model, enum, endpoint, or invariant. It does deliberately **reverse four MVP deviations**,
each justified inline and re-confirmed by the product owner (see the decision ledger):

| Reversed | MVP decision (01–06) | New decision (this doc) | Justification |
|---|---|---|---|
| **Anonymous booking (P3/D-3)** | `POST /bookings` public; contact snapshotted; no `customerId` | **Account required to book**; `POST /bookings` requires `authenticate`; `Booking.customerId` required | Product owner: accounts required. Payments + membership + history all need an identity. |
| **No payments** | `stripe` dep, payments module, webhook mount all removed | Stripe re-added; `modules/payments`; webhook mounted in the pre-marked `app.ts` slot | Revenue on-platform. |
| **Seed is source of truth (02 #14/#15, 04 INV-5)** | Destructive delete-and-recreate reseed owns catalog | **Published `CatalogVersion` is runtime source of truth**; seed becomes bootstrap-only | Admin edits must survive; ops can no longer "fix prod by reseeding." |
| **Auth scaffold unmounted (01)** | `middleware/auth.ts` exists, guards nothing | Scaffold **activated**; re-split into `authenticate.ts` + `authorize.ts`; `/api/v1/admin` sub-router | 01 explicitly anticipates this ("splits back out if the admin surface grows"). |

**What does NOT change (preserved invariants):** integer-cents money; the ported 3-mode pricing
engine and the `PricingModeHandler` registry (zero switches); the recompute integrity guard and
`PRICE_MISMATCH` 422; the id-alignment contract (config `key` == pricing modifier id, verbatim);
the `APX-YYYY-NNNN` `BookingReferenceCounter`; `clientRequestId` idempotency; the QUOTE
`priceTotal`-NULL invariant; one-model-one-writer; the pure-engine / `src/shared/` import-direction
rule; the envelope + `errors.code`-on-every-4xx catalog (D-6). Every new error code is *additive* to
the catalog; every new schema object is a new model or an append-only enum value.

## 1. Locked product decisions (the ledger)

| # | Area | Decision |
|---|------|----------|
| 1 | Accounts | **Required to book.** `Booking.customerId` required; `POST /bookings` authenticated. Lead forms (waitlist, PM B2B, pro application) **stay public**. |
| 2 | Auth | Email/password + **email verification**; httpOnly refresh cookie with rotation + reuse-detection; short-lived Bearer access token held in memory. **TOTP MFA required for staff before staff go-live.** |
| 3 | Roles | customer, **professional**, coordinator, admin. **Catalog pricing/config = admin-only.** Coordinators own bookings, quotes (per-booking final price), refunds, customers, **and dispatch crews to bookings** (see #15). Professionals see only their assigned jobs. |
| 4 | One-time pay | **Charge immediately at booking** (full auto-capture) for PRICED. Amount = the immutable `BookingConfiguration.priceTotal` snapshot. |
| 5 | FROM / QUOTE pay | Booking created unpaid; **coordinator sets final price**, then customer pays via a secure link. |
| 6 | Memberships | **True Stripe Subscriptions**, price **recomputed each cycle**; each paid cycle **auto-creates a fulfillment visit `Booking`**. Members notified on price change. |
| 7 | Refunds | **Default policy**: customer cancels ≥24h before scheduled service → full refund; no-show → no refund. **Coordinators + admins may override** (partial/full); every manual override is recorded in `AdminAuditLog`. |
| 8 | Pricing edits | **Admin-only**, draft → publish, versioned + rollback + audit. |
| 9 | Client | Fully API-driven, phased; ISR + tag invalidation; media stays static for now; keep `next build --webpack`. |
| 10 | Delivery | Full architecture as a backend-first phased roadmap, each phase independently verifiable. |
| 11 | Professionals | Fourth role. **Invite-only onboarding** (approved `ProApplication` → `PRO_INVITE`; no self-register). Dispatched via **crews** (see #15); pros see + fulfil only their assigned jobs. |
| 12 | Stripe account | **Shared with Elevate** (one account, multiple brands). Every Apex Stripe object is tagged `metadata.brand='APEX'`; the webhook **ignores non-Apex events**; refunds are DB-scoped + brand-guarded; statement descriptor is brand-specific. |
| 13 | Email | Provider abstraction (`EmailService`). **Resend** is the production default; **Gmail SMTP** for local dev + QA/testing only; provider selected via env; SES/Postmark pluggable later with no business-logic change. |
| 14 | Pro payments | **Off-platform** — no Stripe Connect, no processor for payouts. The platform records completed work per pro (booking, coordinator approval, payout status, paid date, notes) so payroll reports can be generated; coordinators/admins mark work paid. |
| 15 | Crew dispatch | **Team-first**: build a `Crew` (members + optional lead, active/inactive), then assign the **crew** to a booking (which materializes a per-pro assignment). Individual assignment stays technically possible for the future. |

**Design note on #4 and #6.** #4 charge-immediately resolves the `isEstimate`/"coordinator confirms"
tension by making coordinator confirmation *post-payment*, with refund as the escape hatch. #6 is
finalized (§6.4): membership pricing recomputes every cycle from the **latest published catalog
version** + the member's stored configuration, with a **mandatory member notification** whenever the
amount changes before the next cycle — grandfathered/fixed-at-signup pricing was explicitly rejected.

## 2. Roles & capability matrix (RBAC)

Model **capabilities, not bare roles** (lives in the pre-placed `constants/roles.ts`). **Customers and
professionals hold ownership-scoped capabilities** — a professional's `booking:read:assigned` /
`booking:fulfil` resolve only against bookings where they are an assigned pro (service-layer check),
exactly as a customer's reads resolve only against their own rows. Staff (coordinator/admin) hold
`:any`-scoped capabilities.

```ts
type Permission =
  | 'booking:read:any' | 'booking:transition' | 'booking:assign'        // staff
  | 'crew:manage'                           // build crews, add/remove members, set lead, activate/retire
  | 'payout:manage'                         // approve completed work + mark it paid (off-platform payroll)
  | 'booking:read:assigned' | 'booking:fulfil'                          // professional (ownership-scoped)
  | 'quote:read' | 'quote:manage'          // set QuoteRequest.quotedAmount (per-booking, operational)
  | 'payment:refund'
  | 'demo-inbox:read'
  | 'catalog:draft:write' | 'catalog:publish' | 'catalog:schema:write'  // ADMIN-only (decision #8)
  | 'membership:manage'                     // MembershipPlan CRUD + Stripe Product/Price sync
  | 'pro:manage'                            // approve applications, invite/suspend pros, edit profiles
  | 'user:manage';                          // invite staff, assign roles, suspend

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  CUSTOMER:     [],                                                     // pure ownership scope
  PROFESSIONAL: ['booking:read:assigned','booking:fulfil'],            // only their assigned jobs
  COORDINATOR:  ['booking:read:any','booking:transition','booking:assign','crew:manage',
                 'payout:manage','quote:read','quote:manage','payment:refund','pro:manage',
                 'demo-inbox:read'],
  ADMIN:        [/* COORDINATOR superset */ ...COORDINATOR,
                 'catalog:draft:write','catalog:publish','catalog:schema:write',
                 'membership:manage','user:manage'],
};
```

Key boundaries:
- **Catalog editing** (base prices, deltas, rules, configurators, structure) is **admin-only**.
  Setting a *per-booking* final price for a FROM/QUOTE job (`quote:manage`) is operational and stays
  with coordinators — it is not catalog editing.
- **Dispatch (crew-first)**: coordinators/admins build reusable crews (`crew:manage`) and assign a
  **crew** to a booking (`booking:assign`), which materializes a per-pro `BookingAssignment` for each
  current member (2-person crews are real — the cleaning copy is *"same trusted 2-person team"*).
  Assigning an individual directly stays possible but is not the primary workflow (§5, §6.8).
- **Payroll (`payout:manage`)**: coordinators/admins approve completed work and later mark it paid;
  professional payment itself happens **off-platform** — the platform only records it (decision #14,
  §6.8).
- **Professional visibility**: a pro sees the job it needs to do it — service, configuration, schedule,
  and the customer's contact + service address for *assigned* jobs only — and **never** sees pricing
  internals, payment/refund/payout data, other pros' jobs, or any catalog/admin surface. (Whether pros
  see full vs. partial customer contact is an open question — §12.)

Adding a role or permission is a one-line `ROLE_PERMISSIONS` edit; no per-route rewrites.

## 3. Authentication

Activates the dormant scaffold with **zero env churn**: reuse `utils/jwt.ts` (jsonwebtoken, existing
dep), `utils/password.ts` (bcryptjs, existing dep), and the already-validated
`JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` / `JWT_ACCESS_EXPIRES_IN=15m` / `JWT_REFRESH_EXPIRES_IN=7d`
/ `BCRYPT_SALT_ROUNDS` keys (resolves 01 open-question #4 by **keeping them required**). Adds exactly
two modules from the sanctioned does-not-exist list: **`modules/auth`** and **`modules/users`**;
`users.repository.ts` is the sole writer of `User` + `RefreshToken` + `VerificationToken`.

**One `User` model, two principal types**, discriminated by the `role` claim; one login shape.

**Tokens.**
- **Access**: short-lived JWT (15m, HS256, claims `{ sub, role, tokenVersion, jti, brand:'APEX' }`),
  returned in the JSON body, held **in memory** by the SPA, sent as `Authorization: Bearer`. Not a
  cookie → structurally no CSRF on mutating routes.
- **Refresh**: opaque `crypto.randomBytes(32)`, stored **only as a SHA-256 hash** in `RefreshToken`,
  delivered as `httpOnly + Secure + SameSite=Strict` cookie **path-scoped to `/api/v1/auth/refresh`**,
  plus a required `X-Apex-Client` header (defense-in-depth). **Rotation with reuse detection**: each
  refresh mints a new token in the same `familyId` and sets `replacedById` on the old; presenting an
  already-rotated token **revokes the whole family and bumps `User.tokenVersion`** (kills all live
  access JWTs — see §3.1 for the enforcement caveat).

**Brute-force + lockout (gap fix — no self-inflicted DoS).** Login is guarded by a new
`authRateLimiter` (5 / 15 min, keyed on **IP only**, not IP+email) plus a **per-account soft**
`User.failedLoginCount` / `lockedUntil` that uses **exponential backoff + a CAPTCHA step**, *not* a
hard lock — a hard IP+email lock lets an attacker lock a victim out of their own account (gap-check
finding). Successful login resets the counter.

**Email flows (gap fix — these are hard blockers, not optional).**
- **Email verification**: `POST /auth/register` creates the `User` (`emailVerifiedAt = null`) and
  sends a verification link; unverified customers may browse but **cannot complete a paid booking or
  subscribe** until verified. `POST /auth/verify-email` consumes a `VerificationToken`.
- **Password reset**: `POST /auth/forgot-password` (always 200, no account oracle) → emailed token →
  `POST /auth/reset-password` (consumes token, bumps `tokenVersion` to kill sessions).
- **Staff invite/onboarding**: `POST /admin/users` (admin, `user:manage`) creates a staff `User`
  (`status = INVITED`, no password) and emails a `STAFF_INVITE` token → invitee sets password via
  `POST /auth/accept-invite`, which flips `status = ACTIVE`.
- **Professional onboarding (invite-only — decision #5)**: professionals **cannot self-register**. A
  `ProApplication` is submitted (public form), a coordinator/admin reviews it, and on approval
  (`POST /admin/pro-applications/:id/approve`, `pro:manage`) the server, in one transaction, creates a
  `User` (`role = PROFESSIONAL`, `status = INVITED`), creates its `ProfessionalProfile`, links
  `ProApplication.promotedUserId`, and emails a `PRO_INVITE` token. The pro sets a password via
  `POST /auth/accept-invite` and the account becomes `ACTIVE`.
- All of the above **require a real transactional-email transport (decision #1)** —
  `modules/notifications` is promoted from the demo-inbox stub to a provider-agnostic **`EmailService`
  interface**. The production default implementation is **Resend**; a **Gmail SMTP** implementation
  (via `nodemailer`) serves local dev + QA/testing only; SES/Postmark/etc. can be added later as new
  implementations with no change to business logic. The implementation is chosen by env
  (`EMAIL_PROVIDER` = `resend | smtp`, plus `RESEND_API_KEY` or `SMTP_*` creds and `EMAIL_FROM`), so
  swapping providers never touches callers.

**Staff MFA (decision #2).** TOTP via `otplib`; `User.mfaSecret` stored **AES-256-GCM-encrypted**
under a new `MFA_ENC_KEY`. Login for coordinator/admin requires a valid TOTP after password.
**Required before staff go-live** (Phase 7 gate).

**OAuth is pre-placed, not built**: `User.passwordHash` nullable + `User.authProvider` enum
(`LOCAL` default) allow a later additive Google bolt-on without schema churn.

**Prerequisite (Phase 0):** `CORS_ORIGIN` must move off the `*` default to explicit origins before
any credentialed flow — browsers reject wildcard + credentials, and it's a hole (05 hard warning).
Adds `cookie-parser` after `cors` in the pinned wiring order.

### 3.1 The `tokenVersion` / session-kill honesty note (gap fix)

A stateless JWT cannot be revoked mid-life without a per-request check. Resolution: `authenticate`
does **one indexed PK lookup** of `User.status` + `User.tokenVersion` per request for **all
authenticated routes** (a booking-platform request rate makes this negligible, and it's the only way
suspend/offboard and reuse-detection revocation take effect immediately). If that lookup ever becomes
hot, cache it with a ≤30s TTL and accept ≤30s revocation latency for **customers only** — never for
staff. `status = SUSPENDED` → 401; `tokenVersion` mismatch → 401.

## 4. Authorization

Re-split the collapsed `middleware/auth.ts` into `authenticate.ts` + `authorize.ts` exactly as 01
anticipates. `authorize(...required: Permission[])` resolves `req.user.role → ROLE_PERMISSIONS[role]`,
returns **401 `UNAUTHENTICATED`** if `req.user` absent, **403 `FORBIDDEN`** if the set isn't a
superset. Both are new `ApiError` factories carrying `errors.code` (preserves D-6).

**Router topology.** A new `/api/v1/admin` sub-router applies `authenticate` then per-route
`authorize(...)`; customer-account routes (`/api/v1/me/**`) apply `authenticate` only (ownership at
the service layer). The 12 locked public routers keep their pinned chains untouched, except:
`POST /bookings` and the membership/customer routes move under authentication.

**Two-layer defense for money + PII.** (1) route-layer capability check; (2) **service-layer
ownership re-assertion** for every customer-scoped read (`req.user.sub === Booking.customerId /
Payment.userId / Membership.userId`) before returning — never trust the route alone. IDOR failures
return the **same uniform 404 `BOOKING_NOT_FOUND`** with no oracle fields (extends D3/V17).

## 5. Data model deltas

All new models follow 02 conventions (UUID ids, integer-cents money, `createdAt/updatedAt` except
append-only logs). **New enums:** `Role {CUSTOMER, PROFESSIONAL, COORDINATOR, ADMIN}`,
`AuthProvider {LOCAL, GOOGLE}`, `UserStatus {INVITED, ACTIVE, SUSPENDED}`,
`TokenPurpose {EMAIL_VERIFY, PASSWORD_RESET, STAFF_INVITE, PRO_INVITE}`,
`BookingAssignmentStatus {ASSIGNED, ACCEPTED, DECLINED, COMPLETED}`,
`CrewAssignmentStatus {ASSIGNED, COMPLETED, CANCELLED}`, `PayoutStatus {UNPAID, APPROVED, PAID}`,
`PaymentStatus {REQUIRES_PAYMENT, PROCESSING, SUCCEEDED, FAILED, CANCELED, REFUNDED, PARTIALLY_REFUNDED}`,
`MembershipStatus {INCOMPLETE, ACTIVE, PAST_DUE, UNPAID, PAUSED, CANCELED}`, `StripeEventStatus
{RECEIVED, PROCESSED, FAILED}`, `CatalogVersionStatus {DRAFT, PUBLISHED, ARCHIVED}`. **Append-only
additions:** `BookingStatus += AWAITING_PAYMENT, PAID`; `BookingSource += SUBSCRIPTION`;
`QuoteStatus` unchanged.

**New models (fields → purpose):**

- **`User`** — `email @unique`, `passwordHash?`, `authProvider @default(LOCAL)`, `role @default(CUSTOMER)`,
  `status @default(ACTIVE)`, `emailVerifiedAt?`, `failedLoginCount @default(0)`, `lockedUntil?`,
  `tokenVersion @default(0)`, `stripeCustomerId? @unique`, `name`, `phone?`, `mfaSecret?` (encrypted),
  `mfaEnabledAt?`. Relations: `bookings`, `payments`, `memberships`, `refreshTokens`, `auditLogs`.
- **`RefreshToken`** — `userId`, `tokenHash @unique`, `familyId`, `replacedById? @unique`, `ip?`,
  `userAgent?`, `expiresAt`, `revokedAt?`. onDelete Cascade from `User`.
- **`VerificationToken`** — `userId`, `purpose TokenPurpose`, `tokenHash @unique`, `expiresAt`,
  `consumedAt?`. Powers verify / reset / invite.
- **`Payment`** — `bookingId?` **(NOT unique → 1:N; gap fix for re-pay/partial)**, `userId`,
  `membershipId?`, `stripeInvoiceId?`, `amount` (cents), `currency`, `status PaymentStatus`,
  `stripePaymentIntentId? @unique`, `stripeChargeId?`, `refundedAmount @default(0)`,
  `idempotencyKey @unique` (== the `Payment.id` used as the Stripe Idempotency-Key). Written **only**
  by `payments.repository.ts`.
- **`MembershipPlan`** — `key @unique` (matches client `plans.ts` id), `name`, `description?`,
  `serviceId` (the recurring service priced each cycle), `interval` (`WEEK|MONTH`), `intervalCount`,
  `stripeProductId`, `stripeAnchorPriceId` (the **$0 cadence anchor** — see §7.4), `active`,
  `sortOrder`. Written only by `catalog.repository.ts` under `membership:manage`.
- **`Membership`** — `userId`, `planId`, `serviceId`, `status MembershipStatus`,
  `stripeSubscriptionId @unique`, `configuration Json` (the selections used to recompute each cycle),
  `currentPeriodEnd`, `cancelAtPeriodEnd @default(false)`, `pausedUntil?`, `lastAmount?`. Relation:
  `visits Booking[]`.
- **`StripeEvent`** — `id @id` (Stripe event id), `type`, `status StripeEventStatus @default(RECEIVED)`,
  `processedAt?`, `error?`. **Completion-gated dedupe** (gap fix): a redelivery is a no-op only if
  `status = PROCESSED`; a `RECEIVED`/`FAILED` row is reprocessed.
- **`CatalogVersion`** — `brand`, `version @unique` (`apex-pricing.v2`…), `status CatalogVersionStatus`,
  `snapshot Json` (full catalog+pricing document), `note?`, `createdByUserId`, `publishedByUserId?`,
  `publishedAt?`. **Single PUBLISHED per brand** enforced by a **partial unique index**
  `@@unique([brand, status])` scoped where `status = PUBLISHED` (Postgres partial index) **+ a
  `pg_advisory_xact_lock` in the publish transaction** (gap fix for concurrent publishes).
- **`AdminAuditLog`** — `actorUserId?` **(nullable → system/webhook actors; gap fix)**, `action`,
  `entityType`, `entityId?`, `before Json?`, `after Json?`, `ip?`. Append-only (`createdAt` only).
- **`ProfessionalProfile`** — `userId @unique` (FK → `User`, the pro), `displayName`, `phone?`,
  `trades String[]` (service slugs, validated against `Service.slug` — same non-FK pattern as
  `ProApplication.trades`), `serviceZips String[]` (where they work), `active @default(true)`,
  `applicationId?` (FK → `ProApplication` the pro was promoted from). Read by coordinators to pick who
  to assign. Written only by `users.repository.ts` under `pro:manage`.
- **`BookingAssignment`** — the per-pro fulfilment **and** payroll unit for a booking. `bookingId`
  (FK → `Booking`, Cascade), `proUserId` (FK → `User`, Restrict — history must survive),
  `crewAssignmentId?` (FK → `CrewAssignment`, SetNull — set when materialized from a crew, null for a
  direct individual assignment), `status BookingAssignmentStatus @default(ASSIGNED)`,
  `assignedByUserId` (FK → the coordinator/admin), `assignedAt`, `respondedAt?`, `note?`.
  **Payroll fields (decision #14, off-platform):** `approvedByUserId?`, `approvedAt?`,
  `payoutStatus PayoutStatus @default(UNPAID)`, `payoutAmount? Int` (cents; the agreed pay, entered
  manually), `paidByUserId?`, `paidAt?`, `payrollNote?`. `@@unique([bookingId, proUserId])` (a pro is
  assigned to a booking at most once); `@@index([proUserId, status])` backs the pro's "my jobs" queue;
  `@@index([payoutStatus, paidAt])` backs payroll reports. Written only by `bookings.repository.ts`
  (one-writer: assignments are owned by the booking).
- **`Crew`** — a reusable dispatch team. `name`, `leadProUserId?` (FK → `User`, SetNull; optional
  lead), `active @default(true)` (retire without deleting history), `note?`, `createdByUserId`.
  Relations: `members CrewMember[]`, `assignments CrewAssignment[]`. Written only by
  `crews.repository.ts` under `crew:manage`.
- **`CrewMember`** — `crewId` (FK → `Crew`, Cascade), `proUserId` (FK → `User`, Restrict), `addedAt`.
  `@@unique([crewId, proUserId])`. Many-to-many pros↔crews (a pro can be in several crews).
- **`CrewAssignment`** — the crew↔booking dispatch record (**the primary assignment path**).
  `crewId` (FK → `Crew`, Restrict), `bookingId` (FK → `Booking`, Cascade),
  `status CrewAssignmentStatus @default(ASSIGNED)`, `assignedByUserId`, `assignedAt`, `note?`.
  `@@unique([bookingId, crewId])`. Creating one **materializes a `BookingAssignment` per current
  `CrewMember`** (snapshotting who was dispatched, so a later crew-roster edit never rewrites history).

**Changed existing models:** `Booking` gains `customerId` (**required** FK → `User`, onDelete
Restrict), `membershipId?` (FK for subscription-generated visits), `scheduledAt? DateTime`
(coordinator-set service datetime; drives the pro job queue and the 24h refund window — §6.5),
`payments Payment[]`, `assignments BookingAssignment[]`, and `crewAssignments CrewAssignment[]`.
`QuoteRequest` gains `quotedAmount? Int` (cents), `quotedByUserId?`, `quotedAt?`. `ProApplication`
gains `promotedUserId?` (FK → the `User` created when an application is approved) so the intake→pro
onboarding is traceable. `Service` is unchanged (pricing stays in rows).

## 6. Stripe payments

Re-adds the `stripe` SDK + `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PUBLISHABLE_KEY`.
New `modules/payments` with `payments.repository.ts` as sole writer of `Payment` + `StripeEvent`.
**PCI SAQ A**: card data never touches Apex — Payment Element (one-time) and hosted Checkout
(subscriptions) send PANs directly to Stripe; we store only Stripe object ids.

### 6.1 Webhook mount

Fill the pre-marked empty slot in `app.ts` (between `cors` and `express.json`) with
`express.raw({ type: 'application/json' })` scoped to a **top-level** route `POST /webhooks/stripe`
(NOT under `/api/v1`) so it sits **before** `generalRateLimiter` and is never throttled. Every event
is verified with `stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET)` **before any
parse** — bad/absent signature → 400, zero side effects.

### 6.2 One-time PRICED (charge immediately — decision #4)

The **decisive correctness rule**: the amount charged is **always the immutable
`BookingConfiguration.priceTotal` snapshot** captured at booking creation (which *is* the server
recompute at that instant) — never a fresh recompute at pay time, never a client value. An admin
reprice between booking and payment therefore can never silently over/undercharge.

Flow (single UX, "immediately"):
1. Client validates ZIP (`GET /service-area/validate`) **before** collecting card — we never charge
   an out-of-area customer.
2. `POST /bookings` (authenticated) runs the existing pipeline (recompute guard, `PRICE_MISMATCH`
   422 on stale client cart, `APX-YYYY-NNNN` reference, `clientRequestId` idempotency), creating the
   booking in **`AWAITING_PAYMENT`**. The EP6 200-both-arms union is unchanged (BOOKED arm still
   returns `status:'PENDING'`/`next:'coordinator_confirms'`; `AWAITING_PAYMENT` never leaks into the
   union shape).
3. `POST /bookings/:reference/payment-intent` creates a `Payment` row **first** (fresh `Payment.id`),
   then a PaymentIntent with `amount = priceTotal`, **auto-capture**, Stripe `Idempotency-Key =
   Payment.id`. A legitimate re-pay after a failed/canceled PI creates a **new** `Payment` row → new
   key → fresh PI (this is why `Payment.bookingId` is **not** unique).
4. Client confirms with Payment Element (handles SCA). `payment_intent.succeeded` webhook flips
   `Payment.status = SUCCEEDED` and `Booking.status = PAID` (written **only** through
   `bookings.repository.ts`).
5. **Coordinator confirmation is now post-payment**: coordinator confirms fulfillment; if the job
   can't be done, refund (§6.5). This resolves the `isEstimate` tension per decision #4.

### 6.3 FROM / QUOTE (pay after coordinator sets price — decision #5)

QUOTE bookings keep `priceTotal = NULL` forever (invariant intact). FROM bookings display the band
but are not charged the band. In both cases the booking is created **`AWAITING_PAYMENT`**; a
coordinator sets `QuoteRequest.quotedAmount` (validated `> 0`, bounded by `MAX_QUOTE_CENTS`, audited),
which surfaces to the authenticated customer via `GET /api/v1/me/bookings/:reference`. The customer
then pays via the same `payment-intent` call, charging `quotedAmount` — the one trusted staff-entered
figure, bounded and logged.

### 6.4 Memberships = true subscriptions, recomputed each cycle (decision #6)

`MembershipPlan → Stripe Product`; `User → Stripe Customer` (`stripeCustomerId`). To get **true Stripe
subscriptions** (Stripe owns cadence, dunning, SCA, the customer portal) **and** per-cycle recomputed
pricing, subscribe the customer to a **$0 "anchor" recurring Price** that drives the billing cadence,
then price each cycle by mutating the draft invoice:

1. `POST /api/v1/me/memberships` → **Checkout Session** `mode='subscription'` on the anchor price
   (hosted; collects payment method + SCA). Subscription state is taken from webhooks, never the
   redirect. Store `Membership` with the selected service `configuration`.
2. Each cycle Stripe emits **`invoice.created`** (draft). The handler runs
   `pricingService.recomputeForMembership(serviceId, configuration)` — the **same engine, same
   recompute guard**, pricing against the **latest published `CatalogVersion`** + the member's stored
   `configuration` — and adds the recomputed amount as an **invoice item** to the draft before it
   finalizes. This is where "recompute each cycle" lives (decision #6; grandfathered pricing rejected).
3. On **`invoice.paid`**: mark the cycle paid, write a `Payment` row, and **auto-create a fulfillment
   visit `Booking`** (`source = SUBSCRIPTION`, `membershipId` set, priced from the same snapshot) for
   coordinators to schedule.
4. **Member price-change notice (gap fix):** because recompute can move the charge, on any recomputed
   amount that differs from `Membership.lastAmount`, email the member ahead of `currentPeriodEnd`
   (Stripe's upcoming-invoice window). Persist `lastAmount`.

**Lifecycle (gap fixes):** `invoice.payment_failed` → Stripe Smart Retries drive dunning →
`MembershipStatus PAST_DUE` (benefits/visits suspended) → `UNPAID`/`CANCELED` per policy. Plan
change → Stripe subscription update with **proration**. Seasonal **pause** (power-washing) →
`pause_collection` + `pausedUntil`. Cancel → `cancel_at_period_end` (default) or immediate.

### 6.5 Refunds & cancellation (decision #7)

**Policy (default).** A customer cancellation **≥ 24h before `Booking.scheduledAt`** → **full refund**;
a **no-show** (or cancellation inside the 24h window) → **no refund**. If the booking is not yet
scheduled (`scheduledAt` null), a cancellation is a full refund. **Coordinators/admins may override**
the default and issue a partial or full refund when business circumstances require it; **every manual
override is recorded in `AdminAuditLog`** (actor, amount, reason).

**Mechanics.** The customer-visible `POST /api/v1/me/bookings/:reference/cancel` applies the default
policy automatically (full refund when ≥24h out; none otherwise) and transitions a fully-refunded
booking to `CANCELLED`. The staff override `POST /api/v1/admin/payments/:id/refund` under
`authorize('payment:refund')` (coordinator + admin) takes an **`amount` param**, validates
`amount ≤ Payment.amount − refundedAmount`, uses a **refund idempotency key**, calls
`stripe.refunds.create`, and is reconciled by `charge.refunded` (which updates `refundedAmount` and
sets `REFUNDED`/`PARTIALLY_REFUNDED`); a full refund transitions the booking to `CANCELLED`.

### 6.6 Webhook events + robust processing

Events handled: `payment_intent.succeeded|payment_failed|canceled`, `charge.refunded`,
`checkout.session.completed`, `customer.subscription.created|updated|deleted`,
`invoice.created|paid|payment_failed`.

Processing rules (gap fixes):
- **Completion-gated idempotency**: upsert `StripeEvent` by id; skip only if `status = PROCESSED`.
- **Out-of-order safety**: never trust event ordering — on any subscription/payment transition,
  **re-fetch the object from Stripe** (or guard on the object's own status/timestamp) rather than
  assuming the event reflects current state.
- **Amount-equality backstop**: processing tx verifies `event.amount === Payment.amount` to reject
  tampered/replayed amounts.
- **Metadata threading**: PaymentIntents carry `metadata.paymentId`; Checkout Sessions carry
  `metadata.userId/planId` so `checkout.session.completed` reconstructs the `Membership`.
- **Cross-repository transaction owner (gap fix)**: a webhook that must atomically flip
  `Payment.status` **and** `Booking.status` (and sometimes `Membership.status`) runs a **single
  `prisma.$transaction` owned by `payments.service.ts`**, which *calls into* `bookings.repository`
  and `memberships.repository` write methods — preserving one-model-one-writer while giving the money
  transition one atomic owner.

### 6.7 Shared Stripe account isolation (Apex ⇄ Elevate) — decision #12

Apex and Elevate use **one Stripe account**. Nothing about the API differs (there is still one
`STRIPE_SECRET_KEY`), but object ownership and webhook fan-out must be brand-partitioned so a refund,
reconciliation, or event can never cross brands. Six rules, defense-in-depth:

1. **Tag every object with brand metadata at creation.** Every PaymentIntent, Customer, Product,
   Price, Subscription, Invoice item, and Refund Apex creates carries `metadata.brand = 'APEX'`
   (reuse the pinned `BRAND_CODE`/`Brand` enum). This is the partition key everything else keys on.
2. **The webhook ignores non-Apex events (the critical rule).** A shared account fans *every* event —
   Apex's *and* Elevate's — to *both* projects' configured endpoints, and **Stripe webhook endpoints
   cannot filter by metadata** (only by event type). So after signature verification, the handler
   reads the event's underlying object `metadata.brand`; if it is **not `'APEX'`**, it **acks 200 and
   no-ops** (does not even persist a `StripeEvent`). Only `brand === 'APEX'` events proceed. Events
   whose object has no metadata (rare, e.g. some account-level events) are logged and ignored. This is
   the single most important isolation guarantee — without it Apex would try to process Elevate's
   subscription and payment events.
3. **Refund isolation (two layers).** (a) The refund endpoint looks up the `Payment` **by id in Apex's
   own DB** → gets the Apex `stripePaymentIntentId`; an Elevate charge simply isn't in Apex's DB, so
   it is unreachable. (b) **Belt-and-braces**: before calling `stripe.refunds.create`, re-fetch the PI
   from Stripe and assert `metadata.brand === 'APEX'` — a misconfigured or guessed id can never refund
   an Elevate charge. Reconciliation of `charge.refunded` also runs through rule 2's brand gate.
4. **Namespace idempotency keys + reconciliation queries.** Stripe idempotency keys are account-scoped
   and shared across both brands, so prefix Apex keys (`apex_<paymentId>`) to remove any theoretical
   collision with an Elevate key. The nightly reconciliation job lists Stripe objects filtered to
   `metadata['brand']:'APEX'` (Stripe Search API) so it never touches Elevate payments. Admin
   membership sync (`membership:manage`) only ever reads/writes Products/Prices tagged `APEX`.
5. **Brand-correct statement descriptor.** Set `statement_descriptor_suffix` (and the account's
   dynamic descriptor) so an Apex charge reads as *Apex* on the customer's card statement, not the
   Elevate brand — otherwise shared-account charges confuse customers and drive chargebacks.
6. **Customers are per-brand.** When Apex creates a Stripe `Customer` for a `User`, it tags it `APEX`
   and stores that id in `User.stripeCustomerId`. A person who is also an Elevate customer will have a
   separate Elevate `Customer` object — deliberate: Apex only ever references its own, so subscriptions
   and saved cards never bleed across brands.

> If clean separation is ever preferred over shared-account convenience, Stripe **Restricted API
> keys** don't segregate webhooks, but a **separate Connect account / separate Stripe account** would.
> The metadata-partition approach above is the standard way to run multiple brands on one account and
> is fully sufficient here.

### 6.8 Professional dispatch & payroll — off-platform (decisions #14, #15)

**Dispatch is crew-first.** Coordinators build reusable `Crew`s (`crew:manage`) — members + an optional
lead, `active`/inactive — that reflect how a home-service company actually sends out recurring teams.
Assigning a crew to a booking (`POST /admin/bookings/:reference/crew`, `booking:assign`) writes a
`CrewAssignment` and, in the same transaction, **materializes one `BookingAssignment` per current crew
member** — a snapshot, so editing the crew roster later never rewrites a past dispatch. (The dispatch
service owns this `prisma.$transaction`, writing `CrewAssignment` via `crews.repository` and each
`BookingAssignment` via `bookings.repository` — one-writer preserved, mirroring §6.6.) The pro's
`/me/jobs` queue and the `booking:read:assigned`/`booking:fulfil` scope resolve against those
`BookingAssignment` rows. Direct individual assignment (`POST .../assignments`) writes a
`BookingAssignment` with `crewAssignmentId = null` and stays available for the future, but the primary
operational workflow is **Crew → Booking**.

**Professional payment is entirely off-platform — no Stripe Connect, no payout processor.** The
platform's only job is to keep an accurate record so payroll can be run and reported. Each
`BookingAssignment` carries the payroll trail: a coordinator/admin (`payout:manage`) marks completed
work **approved** (`approvedByUserId`/`approvedAt`, `payoutStatus = APPROVED`, optional `payoutAmount`
= the agreed pay), then later marks it **paid** (`paidByUserId`/`paidAt`, `payoutStatus = PAID`,
optional `payrollNote`) once payment has been made outside the system. `GET /admin/payroll` reports
completed / approved / paid work by professional and date range for payroll runs. No money for
professionals ever moves through Apex or Stripe.

## 7. Admin-controlled catalog (pricing + configuration)

An **editorial draft → publish pipeline with immutable versioned snapshots** — this single mechanism
resolves the seed-vs-DB authority, one-writer, id-alignment, negative-delta, and recompute-consistency
concerns at once. **Admin-only** (decision #8).

- **Edit drafts, never live rows.** A `CatalogVersion` (status `DRAFT`) holds the full catalog+pricing
  document as `snapshot Json` (union of `apex-pricing.v1.json` + `apex-catalog.json` — config keys ==
  pricing ids, so they move atomically together). Admins `PATCH` the draft. Because drafts live in
  JSON, there is **no `@@unique([serviceId,key])` collision** with the live tables.
- **One-writer fix.** Extract the seed's write+validate routine into a single
  **`catalog.repository.ts`** — henceforth the sole runtime writer of `Service` pricing columns +
  `ServiceConfigGroup` / `ServiceConfigOption` / `ServicePricingRule`. `prisma/seed.ts` calls into it.
- **Seed becomes bootstrap-only.** Publishes `CatalogVersion v1` from `apex-pricing.v1.json` **only if
  no PUBLISHED version exists** (idempotent create-if-absent). The destructive resync is gated behind
  a `SEED_RESYNC=true` non-prod flag. *This is the documented reversal of 02 #14/#15 & 04 INV-5.*
- **Publish = one `$transaction`** (holding a `pg_advisory_xact_lock`): (1) run the **exact same
  validation gate the seed uses** — `assertAligned()` (group/option `key` == modifier/option id,
  verbatim, never slugged), key regex `^[a-z0-9]+(?:-[a-z0-9]+)*$`, `uiHint` known-list, TOGGLE/
  QUANTITY/TEXTAREA shape lint, **`priceDelta >= 0`** (discounts only via `ServicePricingRule`
  effects), **`priceDelta <= MAX_DELTA_CENTS` price ceiling (gap fix)**, and
  `PricingTableSchema/RuleTriggerSchema/RuleEffectSchema.parse` — misalignment fails loudly as **422
  `CATALOG_VALIDATION_FAILED`** reusing existing violation codes, so an id-alignment money-bug is
  *physically un-shippable*; (2) reject structural diffs unless `catalog:schema:write`; (3)
  delete-and-recreate the live config rows exactly as the seed does today; (4) archive the prior
  PUBLISHED version, mark this PUBLISHED, record `publishedByUserId/publishedAt`.
- **Validator home:** module-side (`modules/pricing/validation`), **not** `src/shared/` — it
  references Prisma enums and throws `ApiError`, which the shared-boundary rule forbids.
- **Engine untouched.** The engine, id-alignment contract, `PricingModeHandler` registry, and
  `recomputeForBooking` still read live rows; admin edits are just a governed new path to the same
  rows. The **active version string** is the published `CatalogVersion.version`, resolved at the
  module layer and passed into the pure engine via `PricingModeContext` as data;
  `BookingConfiguration.pricingVersion` records which version priced each booking.
- **Recompute consistency.** Publish is atomic; a reprice between a client preview and `POST /bookings`
  is absorbed by the existing `PRICE_MISMATCH` 422 → client re-previews. Post-booking, the immutable
  snapshot means a later reprice never re-prices a committed booking or its payment.
- **Audit + rollback.** Every draft edit and publish writes `AdminAuditLog` (before/after Json). Each
  PUBLISHED snapshot is a price-history entry; `POST /admin/catalog/versions/:id/restore` re-publishes
  an archived snapshot as a **new** version (re-running the lint gate — a rollback that fails
  validation fails loudly rather than corrupting).

## 8. API-driven client migration

The Next.js 16 App Router client drops all `src/data` pricing literals and **deletes both divergent
client price engines** — `SPEC.compute()` in `src/lib/service/runtime.js` and `priceFor()` (including
its **phantom 7% tax** and home-size field) in `src/lib/booking/runtime.js` — collapsing the three
inconsistent client price sets onto the single server recompute.

- **Canonical key everywhere is `Service.slug`** (== `pricingRef` 1:1). Remove the booking engine's
  short-id SLUG bridge map and the frontend-only CONSULT state (home-security is QUOTE server-side).
- **The 7% client tax is dropped, not migrated** — it is a client fabrication absent from the
  authoritative engine and cannot be modeled as an engine Fee (the engine freezes subtotal after the
  modifier loop; tax-on-post-discount-total needs a new engine pass, out of scope). **If real sales
  tax is required, it is computed by Stripe Tax at charge time, not by the engine — see §12.**
- **Fetch layer.** `page.tsx` server components do the public reads via **ISR** — `GET /services`,
  `/services/:idOrSlug`, `/services/:idOrSlug/config`, `/membership/plans`, `/service-area/zips` —
  with `fetch(..., { next: { revalidate: 300, tags: ['catalog','service:'+slug] } })`. Live price
  preview stays a **client-side, debounced, uncached** `POST /services/:idOrSlug/config/price`.
  Booking submit + account/admin pages are dynamic `no-store` with the Bearer token forwarded.
- **Login-gated booking (decision #1).** The booking modal/flow now requires authentication before
  submit; anonymous users hit a login/register step. Lead forms stay public.
- **Publish-triggered invalidation.** On a successful `CatalogVersion` publish, the backend pings a
  new client `POST /api/revalidate` (shared secret) → `revalidateTag('catalog')` — instant, precise
  cache-bust instead of TTL waits.
- **Booking submit** replaces the fake `setTimeout`/confetti with the real `POST /api/v1/bookings`
  (rendering the real `APX-YYYY-NNNN` reference) then, for PRICED, `POST /bookings/:reference/
  payment-intent` + Payment Element.
- **Content stays static for now.** Marketing copy already maps to
  `Service.summary/description/badges/claimsBlock`; per-page testimonials/media have no backend model
  and remain static client data (new `Testimonial`/`ServiceMedia` models deferred to Phase 7).
- **Build safety.** Keep the pinned `next build --webpack` (Turbopack `/book` hydration bug). Add
  `middleware.ts` gating `(account)` and `(admin)` route groups. After each build, smoke-test `/book`
  and every new hydration-heavy authed/admin route (confirm `/_next/static/chunks/*.js` → 200). The
  DOM-injection runtimes are refactored in place (same mounts call `fetch`/real submit) rather than
  rewritten wholesale — lowest risk against the Turbopack bug.

## 9. New / changed endpoint surface

| Method | Path (`/api/v1` unless noted) | Access | Purpose |
|---|---|---|---|
| POST | `/auth/register` | public | Customer self-register (role forced CUSTOMER); sends verify email |
| POST | `/auth/login` | public + `authRateLimiter` | Password (+ TOTP for staff) → access JWT + refresh cookie |
| POST | `/auth/refresh` | cookie + `X-Apex-Client` | Rotate refresh, mint access (reuse-detection) |
| POST | `/auth/logout` | authed | Revoke refresh family |
| POST | `/auth/verify-email` · `/auth/forgot-password` · `/auth/reset-password` · `/auth/accept-invite` | public | Email flows |
| GET | `/me` · PATCH `/me` | authed | Profile |
| GET | `/me/bookings` · `/me/bookings/:reference` | authed (ownership) | My bookings (replaces email-match lookup) |
| POST | `/me/bookings/:reference/cancel` | authed (ownership) | Customer cancellation (policy window) |
| GET | `/me/jobs` · `/me/jobs/:reference` | `booking:read:assigned` (scoped) | Professional's assigned jobs |
| PATCH | `/me/jobs/:reference/status` | `booking:fulfil` (scoped) | Pro updates assignment status (ACCEPTED / COMPLETED / DECLINED) |
| GET | `/me/memberships` · POST `/me/memberships` · DELETE `/me/memberships/:id` | authed (ownership) | Subscribe / cancel; POST returns a Checkout Session |
| POST | `/bookings` | **authed** (was public) | Core Flow submit; creates `AWAITING_PAYMENT` |
| POST | `/bookings/:reference/payment-intent` | authed (ownership) | Create/refresh PaymentIntent for a booking |
| GET | `/membership/plans` | public (ISR) | Plan catalog for the client |
| POST | `/webhooks/stripe` (**top-level**) | Stripe sig | Raw-body webhook |
| GET/PATCH | `/admin/catalog/versions` · `/admin/catalog/versions/:id` | `catalog:draft:write` | Draft CRUD |
| POST | `/admin/catalog/versions/:id/publish` · `/restore` | `catalog:publish` (+ `catalog:schema:write` for structural) | Publish / rollback |
| CRUD | `/admin/membership-plans` | `membership:manage` | Plan + Stripe Product/Price sync |
| GET/PATCH | `/admin/bookings` · `/admin/bookings/:reference` | `booking:read:any` / `booking:transition` | Ops queue + status transitions |
| GET/PATCH | `/admin/quotes` · `/admin/quotes/:id` | `quote:read` / `quote:manage` | Set `quotedAmount` |
| CRUD | `/admin/crews` · `/admin/crews/:id/members` | `crew:manage` | Build crews; add/remove members; set optional lead; activate/retire |
| POST/DELETE | `/admin/bookings/:reference/crew` | `booking:assign` | Assign/unassign a **crew** (materializes per-pro assignments) — primary path |
| GET/POST/DELETE | `/admin/bookings/:reference/assignments` | `booking:assign` | Individual pro assign/unassign (secondary path) |
| GET | `/admin/professionals` · GET `/admin/pro-applications` | `pro:manage` | List pros / triage applications for dispatch |
| POST | `/admin/pro-applications/:id/approve` | `pro:manage` | Approve → create `PROFESSIONAL` user + `ProfessionalProfile`, send `PRO_INVITE` |
| PATCH | `/admin/professionals/:id` | `pro:manage` | Edit profile / trades / suspend a pro |
| GET | `/admin/payroll` | `payout:manage` | Completed-work report by professional + date range (off-platform payroll) |
| PATCH | `/admin/assignments/:id/payout` | `payout:manage` | Approve completed work / mark paid (records off-platform payment) |
| POST | `/admin/payments/:id/refund` | `payment:refund` | Refund override (default policy auto-applies on cancel; partial/full) |
| CRUD | `/admin/users` | `user:manage` | Invite/suspend staff, assign roles |
| GET | `/admin/demo-inbox` | `demo-inbox:read` | (retention/redaction policy required first) |
| POST | `/api/revalidate` (Next client) | shared secret | Publish-triggered ISR bust |

The 12 locked public catalog/lead-form endpoints from 05 remain, unchanged except `POST /bookings`
moving under auth and the email-match lookup being superseded by `/me/bookings`.

## 10. Security model (consolidated)

- **Webhooks**: signature-verified on a top-level raw-body route before parse; completion-gated
  replay dedupe; out-of-order guarded by Stripe re-fetch; amount-equality backstop.
- **PCI**: SAQ A — PANs go straight to Stripe; we store only ids; nothing card-shaped in logs.
- **Token theft**: 15m in-memory Bearer access (no CSRF surface, not persisted); refresh stored only
  as SHA-256 hash in an httpOnly+Secure+SameSite=Strict path-scoped cookie + `X-Apex-Client`;
  rotation + family reuse-detection + `tokenVersion` bump for revocation.
- **IDOR / enumeration**: service-layer ownership re-assertion; uniform 404; no email-alone reads. A
  **professional's** `booking:read:assigned`/`booking:fulfil` resolve only against bookings with a
  matching `BookingAssignment.proUserId === req.user.sub`; a pro reading an unassigned booking gets
  the uniform 404, and pros never receive pricing/payment/payout fields.
- **Shared Stripe account**: every event is brand-gated (`metadata.brand === 'APEX'` or no-op ack);
  refunds are Apex-DB-scoped + re-verified against PI brand metadata; idempotency keys are
  `apex_`-namespaced; reconciliation queries filter to `brand:APEX` — so no Apex operation can ever
  touch an Elevate charge, subscription, or event (§6.7).
- **Price tampering**: one-time charges use the immutable `priceTotal` snapshot; QUOTE uses bounded,
  audited coordinator `quotedAmount`; recompute guard + `PRICE_MISMATCH` 422 + webhook amount check.
- **Staff privilege**: role is a signed claim; least-privilege capabilities; structural catalog
  changes need `catalog:schema:write`; every admin mutation writes `AdminAuditLog`; **TOTP MFA for
  staff**; suspend/offboard enforced per-request via `status`/`tokenVersion`.
- **Rate limits**: keep IP `generalRateLimiter`; add `authRateLimiter` (5/15m per IP) on login/
  register; webhook exempt (outside `/api`).
- **PII / privacy**: GDPR/CCPA **erasure + export** endpoints; retention policy spanning
  `FormSubmissionLog`, `AdminAuditLog`, `RefreshToken`, and booking contact snapshots; erasure
  anonymizes booking snapshots (Restrict FK preserved) rather than hard-deleting financial history;
  nightly `RefreshToken` prune job.
- **Prerequisite**: explicit `CORS_ORIGIN` before any credentialed flow.

## 11. Backend-first phased roadmap

Each phase is independently shippable and verifiable; the client (Phase 8) lands only after the API
it consumes is proven.

| Phase | Deliverable | Verification |
|---|---|---|
| **0** | Prereqs: `CORS_ORIGIN` explicit; `cookie-parser`; **configure `EmailService` (Resend prod / Gmail SMTP dev) via env**; **decide sales-tax stance + deploy topology (§12)** | env validates; CORS rejects wildcard+creds |
| **1** | `modules/auth` + `modules/users`; `User/RefreshToken/VerificationToken`; register/login/refresh/logout; rotation + reuse-detection; `authRateLimiter` | vitest: rotation, reuse-detection revokes family, lockout backoff, `tokenVersion` kill |
| **2** | `EmailService` abstraction (Resend prod impl + Gmail SMTP dev impl); email verification, password reset, staff invite/accept | end-to-end token consume; unverified cannot pay; provider swap via env only |
| **3** | `authorize` re-split + capability map (incl. **PROFESSIONAL**) + `/api/v1/admin` sub-router + `/me/**`; **`ProfessionalProfile` + invite-only approve→onboard; `Crew`/`CrewMember`/`CrewAssignment` crew-first dispatch materializing `BookingAssignment`; off-platform payroll (approve/mark-paid) + `/me/jobs`**; ownership re-assertion; `AdminAuditLog` | 401/403 matrix; IDOR uniform 404; pro sees only assigned jobs w/o pricing/payout; **crew→booking materializes per-pro assignments; coordinator approves + marks work paid; payroll report lists paid/unpaid by pro** |
| **4** | `CatalogVersion` draft→publish; `catalog.repository`; seed→bootstrap; validation gate + ceilings; advisory-lock publish; rollback | publish rejects misaligned/negative/over-ceiling diffs (422); reseed no longer wipes edits |
| **5** | `modules/payments`; webhook mount + verification + `StripeEvent`; **shared-account brand isolation (§6.7)**; one-time PRICED charge-at-booking; QUOTE `quotedAmount` pay; refunds | Stripe test-mode: succeeded→PAID, partial refund cap, replay no-op, out-of-order re-fetch, amount tamper rejected; **an Elevate-tagged test event is no-op'd; refund of a non-APEX PI is rejected** |
| **6** | Memberships: `MembershipPlan/Membership`; Checkout subscribe; `invoice.created` recompute + invoice item; `invoice.paid` → visit `Booking`; dunning/proration/pause; price-change notice | test-clock: cycle recompute correct, failed-payment dunning, visit auto-created, plan-change proration |
| **7** | Staff **TOTP MFA** (gate for staff go-live); GDPR erasure/export + retention/prune jobs; nightly Stripe reconciliation; (deferred `Testimonial`/`ServiceMedia` content models) | MFA required for staff; reconciliation catches a dropped webhook |
| **8** | **Client**: delete both price engines + phantom tax; ISR fetch layer; login-gated booking; real submit + Payment Element; membership Checkout; `revalidateTag` bust; `(account)`/`(admin)` route groups | `next build --webpack` clean; `/book` + authed/admin routes hydrate (chunks 200); prices match server recompute exactly |

## 12. Open questions / decisions still needed

Ranked; the first two **block** their phases (deploy topology → Phase 1; sales tax → Phase 5).

1. **Deploy topology for the refresh cookie** (blocks Phase 1 cookie design). `SameSite=Strict`
   path-scoped refresh needs the SPA and API to be **same-site** (e.g. `app.apex.com` + `api.apex.com`
   under `apex.com`). If they're cross-site, we need `SameSite=None; Secure` + explicit CORS, or a
   same-origin proxy. Where do client and API deploy?
2. **Sales tax** (blocks charging real money in Phase 5). NC taxes many home services. Recommend
   **Stripe Tax** (tax computed on the PaymentIntent/Invoice at charge time; the engine stays
   pre-tax). Need: are these services taxable, and is Stripe Tax approved? If tax is out-of-scope for
   launch, that must be an explicit, documented finance decision.
3. **Member discount on one-time (ad-hoc) bookings.** Do active members get a discount on *one-off*
   bookings outside their subscription? Default here: **no cross-discount** (subscription pricing
   applies only to subscribed recurring visits) to avoid double-discount with the frequency rules.
   Confirm or specify the member-discount policy.
4. **FROM charge model.** Confirm FROM behaves like QUOTE (coordinator sets final price, then pay) —
   i.e. FROM is never charged the displayed band automatically. Assumed yes.
5. **Professional data visibility.** Does an assigned pro see the customer's **full** contact + exact
   address, or a **masked** contact (e.g. masked phone / proxy) until the job is accepted/day-of? PII
   minimization argues for masking; ops simplicity argues for full. Default: full for accepted jobs.
6. **Staff MFA timing.** Required before staff go-live (assumed). Confirm no earlier hard requirement.
7. Inherited 01–06 open items now in-scope: address redaction on re-read (resolved here: full address
   only to owner + assigned staff/pro), `FormSubmissionLog` retention, and the SAMPLE pricing sign-offs.

## 13. Provenance

Designed against the verified 01–06 blueprint (schema, pricing engine, config engine, API/validation,
pipeline) and the real client (`client/src/**`). Produced by a 17-agent workflow — 6 backend-doc
readers + 3 client analyses → 3 independent architecture candidates (pragmatic / security-first /
extensible) → 3 adversarial critiques → synthesis → a completeness gap-check — then reconciled
against the product owner's locked decisions (§1). Every gap-check finding (Payment 1:N, completion-
gated dedupe, out-of-order webhooks, partial-refund cap, `tokenVersion` enforcement, lockout DoS,
password-reset/email transport, staff lifecycle, GDPR, publish concurrency, price ceilings, nullable
audit actor) is folded in above.
