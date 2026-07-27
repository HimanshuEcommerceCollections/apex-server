# Foundations: repo layout, module pattern, app wiring

This is section 01 of the Apex Total Home Services backend architecture. It covers Deliverable 1:
the folder structure of `c:\work\Apex\server`, the package/tooling baseline, the Express app wiring,
and the feature-module pattern every other section builds on. The architecture mirrors the Elevate
server at `c:\work\Elevate Health & Wellness\Server` file-for-file except where a deviation is
explicitly called out below (pattern: "Deviation: X -- justified by Y").

The reader is the backend developer who will implement this repo file-by-file. You do not need to
have read the other section files first; where a topic is owned by a sibling section, this document
names the file instead of duplicating it.

## Section map (how this doc series is organized)

| File | Deliverable(s) | Owns |
|---|---|---|
| `01-foundations.md` (this file) | 1 | Repo layout, package.json, tsconfig, env, app wiring, module pattern, middleware inventory, shared-component placement |
| `02-database.md` | 2 | Full `prisma/schema.prisma`: models, enums, relations, indexes |
| `03-pricing-engine.md` | 3, 7 | Engine port, conditional rules layer, PricingMode handlers, per-service pricing strategy |
| `04-configuration-engine.md` | 4 | Config groups/options as reusable input primitives; no per-service code |
| `05-api-and-validation.md` | 5, 6 | Every endpoint with request/response examples; zod schemas, reference validation, business validation, zip validation |
| `06-pipeline-shared-roadmap.md` | 8, 9, 10 | POST /bookings end-to-end (validation, recompute, zip gate, reference, storage); cross-brand components with "how a future brand consumes this" notes; backend-first build order |

Cross-references below use these six filenames.

## Decisions made in this section

| # | Decision | Choice | Rejected alternative | Why |
|---|---|---|---|---|
| 1 | Worked-example module | `waitlist` | `bookings` | Smallest module that still exercises the full 7-file pattern, the public+rate-limited route style, idempotency, and contract serialization |
| 2 | Health check placement | `modules/health` mini-module with its own repository | Elevate's inline handler in `routes/index.ts` | The foundation spec pins `modules/health` in the module list; side benefit: `routes/index.ts` no longer imports `prisma`, making "repository is the only prisma toucher" absolute |
| 3 | Duplicate waitlist submit | Idempotent success (200, existing record returned) | Elevate's 409 on ACTIVE duplicate | PRD: the zip-miss flow must never dead-end; `@@unique([email, zip])` exists to absorb double-submits |
| 4 | JWT/bcrypt env keys | Keep, required, documented as post-MVP-admin-only | Make optional until admin lands | Mirrors Elevate's `env.ts` verbatim; admin surface lands later with zero env churn |
| 5 | `scripts/postinstall.js` | Port Elevate's Render-gated build hook | Drop it | Same deploy-target class as Elevate; the script is a no-op on developer machines |
| 6 | Route-scoped rate limiters | Three hardcoded limiters on top of the env-driven `generalRateLimiter`: `previewRateLimiter` (120/15 min, price preview), `formRateLimiter` (20/15 min, the four form POSTs), `lookupRateLimiter` (30/15 min, booking lookup) -- values pinned in `05-api-and-validation.md` | One limiter for everything, or per-limiter env keys | Mirrors how Elevate hardcodes `authRateLimiter` at 10; the preview endpoint fires once per selection change, so a form-tight 20/window ceiling would lock a user out mid-configuration; no new env keys without justification |
| 7 | Pricing engine core placement | `modules/pricing/engine/` treated as a zero-Apex-import shared boundary | `src/shared/pricing/` | The foundation spec pins the path `modules/pricing/engine/compute-price.ts`; the import rule (below) preserves extractability |
| 8 | `config/service-assets.ts` | Static read-only slug-to-asset map | Elevate's mutable JSON registry + upload env keys | Apex MVP has no admin uploads (multer dropped); a const module suffices |
| 9 | `quotes` module routing | ROUTELESS internal module (not mounted in `routes/index.ts`) | Mounted at `/quotes` with read endpoints | The MVP endpoint surface (`05-api-and-validation.md`) is exactly 12 endpoints with no `/quotes` routes; demo-inbox reads happen via Prisma Studio/psql in MVP, with an optional authenticated `GET /demo-inbox` deferred post-MVP (`06-pipeline-shared-roadmap.md`). `quotesService`/`quotesRepository` stay as the single writer of `QuoteRequest` rows for the booking pipeline and pm-requests |
| 10 | Prisma naming of the compound unique | `email_zip` (Prisma default for `@@unique([email, zip])`) | Custom name | Elevate uses default compound-unique names (`serviceId_userId`) |

## Repository layout (full annotated tree)

Money is ALWAYS integer cents (`Int` minor units) everywhere in this tree: seed data, engine math,
DB columns, API payloads (`Money = { amount, currency }`).

```
c:\work\Apex\server
|- package.json                    # name "apex-server" -- full listing below
|- tsconfig.json                   # ported verbatim from Elevate -- listing + notes below
|- .env                            # local only, gitignored
|- .env.example                    # exact key list below
|- .gitignore                      # node_modules/, dist/, .env
|- scripts/
|  `- postinstall.js               # Render-gated build hook (prisma generate + tsc + migrate deploy);
|                                  # exits immediately on dev machines. Ported from Elevate.
|- prisma/
|  |- schema.prisma                # single source of truth for ALL models + enums (see 02-database.md)
|  |- migrations/                  # prisma migrate dev output, committed
|  |- seed.ts                      # idempotent seed (upserts): categories -> services -> config groups/
|  |                              #   options -> pricing rules -> service-area zips. Run via tsx.
|  `- seed-data/
|     |- apex-catalog.json         # the 11 services + 3 categories: names, slugs, pricingMode,
|     |                            #   pricingRef, badges, claimsBlock, sortOrder
|     |- apex-pricing.v1.json      # pricing table (CENTS): base prices, modifiers, conditional rules,
|     |                            #   fees -- keys id-aligned with config group/option keys
|     `- service-area.v1.json      # THE shared Raleigh zip allowlist. Apex owns this file; future
|                                  #   Raleigh brands consume it verbatim (see 06-pipeline-shared-roadmap.md)
|- docs/
|  `- architecture/
|     |- 01-foundations.md         # this file
|     `- 02-...-06-*.md            # sibling sections per the Section map above
`- src/
   |- app.ts                       # createApp(): builds & configures Express -- does NOT listen
   |- server.ts                    # bootstrap: createApp().listen + graceful shutdown
   |- config/
   |  |- env.ts                    # zod-validated process.env -> typed `env`, isProd/isDev/isTest;
   |  |                            #   fails fast (process.exit) on missing/malformed vars
   |  `- service-assets.ts         # static map: service slug -> icon/cover path (read-only in MVP;
   |                               #   no uploads, so Elevate's mutable JSON registry is not ported)
   |- constants/
   |  |- index.ts                  # barrel (export * from each file)
   |  |- http-status.ts            # HttpStatus map -- ported verbatim from Elevate
   |  |- messages.ts               # reusable response message strings
   |  |- brand.ts                  # BRAND_CODE = "APX", PRICING_VERSION = "apex-pricing.v1",
   |  |                            #   REFERENCE_PAD = 4 (zero-pad width of the NNNN sequence)
   |  `- roles.ts                  # staff role sets -- post-MVP admin scaffold, unused in MVP
   |- db/
   |  `- client.ts                 # the single shared PrismaClient (globalThis-cached in dev)
   |- enums/
   |  |- index.ts                  # re-exports Prisma enums (schema.prisma is the single source of
   |  |                            #   truth) + app.enums -- app code imports enums ONLY from here
   |  `- app.enums.ts              # non-DB enums: SortOrder, BookingOutcome { BOOKED, WAITLISTED }
   |                               #   (the POST /bookings discriminated-union tag; see 06-pipeline-shared-roadmap.md)
   |- middleware/
   |  |- index.ts                  # barrel
   |  |- validate.ts               # validate({ body?, query?, params? }) -- zod parse, mutates req in
   |  |                            #   place, 422 ApiError with per-field details
   |  |- error-handler.ts          # global translator: ApiError / ZodError / Prisma P2002+P2025 -> envelope
   |  |- not-found.ts              # 404 fallback, registered after all routes
   |  |- rate-limit.ts             # generalRateLimiter (env-driven, mounted at /api) + three hardcoded
   |  |                            #   route limiters: previewRateLimiter (120/15 min, config/price),
   |  |                            #   formRateLimiter (20/15 min, the four form POSTs), lookupRateLimiter
   |  |                            #   (30/15 min, GET /bookings/:reference) -- table in 05-api-and-validation.md
   |  `- auth.ts                   # authenticate/authorize SCAFFOLD -- compiles, guards NOTHING in MVP;
   |                               #   exists so the post-MVP admin surface bolts on without rework
   |- modules/
   |  |- health/                   # GET /api/v1/health (reduced module -- no validation/types; the
   |  |  |- index.ts               #   routeless `pricing` and Elevate's `notifications` set the
   |  |  |- health.routes.ts       #   precedent that partial modules are allowed)
   |  |  |- health.controller.ts   # standard envelope: { success, message, data: { status, db, version } };
   |  |  |- health.service.ts      #   503 with errors.code DB_UNAVAILABLE when the DB ping fails
   |  |  `- health.repository.ts   # pingDb(): prisma.$queryRaw`SELECT 1`
   |  |- services/                 # catalog reads: GET /services, GET /services/:idOrSlug
   |  |  |- index.ts               # barrel: servicesRouter + servicesService
   |  |  |- services.routes.ts     # public reads; mounts serviceConfigRouter at /:idOrSlug/config
   |  |  |- services.controller.ts
   |  |  |- services.service.ts    # serialization DB row -> response DTO; ACTIVE/COMING_SOON visibility
   |  |  |- services.repository.ts
   |  |  |- services.validation.ts # list filters (category, status), idOrSlug param schema
   |  |  |- services.types.ts
   |  |  `- config/                # nested sub-module (Elevate parity: services/config/, no own index.ts;
   |  |     |                      #   services.routes.ts imports the router directly)
   |  |     |- service-config.routes.ts     # Router({ mergeParams: true }): GET / (configurator payload),
   |  |     |                               #   POST /price (live preview -- body { selections, quantity? })
   |  |     |- service-config.controller.ts
   |  |     |- service-config.service.ts    # assembles service + ordered groups[] + options[] + mode +
   |  |     |                               #   rules summary; delegates preview to pricingService
   |  |     |- service-config.repository.ts
   |  |     |- service-config.validation.ts # selections record schema, quantity, params
   |  |     `- service-config.types.ts
   |  |- pricing/                  # ROUTELESS internal module (Elevate precedent: notifications has no
   |  |  |                         #   routes/controller). NOT mounted in routes/index.ts. Consumed by
   |  |  |                         #   services/config (preview) and bookings (authoritative recompute).
   |  |  |                         #   File layout owned by 03-pricing-engine.md section 3.
   |  |  |- index.ts               # barrel: exports pricingService, computePrice, evaluateRules -- no router
   |  |  |- pricing.service.ts     # preview(idOrSlug, input) + recomputeForBooking(idOrSlug, input, clientPrice);
   |  |  |                         #   dispatches through the PricingModeHandler registry -- the ONLY dispatch
   |  |  |- pricing.repository.ts  # loads Service + config groups + options + ServicePricingRule rows in
   |  |  |                         #   one read shaped for the engine
   |  |  |- pricing.types.ts       # PricePreview (mode-discriminated), PricePreviewInput, PricingModeContext
   |  |  |- build-pricing-table.ts # DB rows -> engine PricingTable (the id-alignment consumer)
   |  |  |- modes/                 # the PricingMode handler registry (adding a mode = handler + enum value)
   |  |  |  |- handler.types.ts    # PricingModeHandler interface
   |  |  |  |- registry.ts        # Record<PricingMode, handler> -- exhaustiveness-checked, zero switches
   |  |  |  |- priced.handler.ts
   |  |  |  |- from.handler.ts
   |  |  |  `- quote.handler.ts
   |  |  `- engine/                # PURE core -- ZERO Apex imports (shared boundary; see import rule)
   |  |     |- types.ts            # PricingTable, Modifier, Fee, PricingRule, Configuration, DisplayedPrice,
   |  |     |                      #   LineItem, Money -- standalone (no Prisma types)
   |  |     |- money.ts            # addMoney/scaleMoney/zeroMoney/negateMoney (Elevate money.ts port)
   |  |     |- compute-price.ts    # the Elevate engine port (pinned path): base*quantity -> modifiers ->
   |  |     |                      #   conditional rules -> fees; integer-cent math (see 03-pricing-engine.md)
   |  |     `- evaluate-rules.ts   # conditional rules evaluator: min_selected, option_selected triggers ->
   |  |                            #   fee/discount LineItems in the fee slot
   |  |- bookings/                 # the Core Flow submit + success-page re-read
   |  |  |- index.ts               # barrel: bookingsRouter + bookingsService
   |  |  |- bookings.routes.ts     # POST / (public + formRateLimiter), GET /:reference (email-match guard)
   |  |  |- bookings.controller.ts
   |  |  |- bookings.service.ts    # the booking pipeline: reference validation -> zip gate -> recompute ->
   |  |  |                         #   transaction (counter increment, booking + configuration + optional
   |  |  |                         #   quote_request rows) -- full walkthrough in 06-pipeline-shared-roadmap.md
   |  |  |- bookings.repository.ts # ONLY writer of Booking/BookingConfiguration/BookingReferenceCounter
   |  |  |- bookings.validation.ts
   |  |  |- bookings.types.ts      # CreateBookingDto, BookingResponse, the BOOKED|WAITLISTED union
   |  |  `- booking-reference.ts   # nextBookingReference(tx): counter upsert-increment inside the booking
   |  |                            #   transaction; calls shared/reference for the APX-YYYY-NNNN formatting
   |  |- quotes/                   # ROUTELESS internal module (decision #9): quote_request records created
   |  |  |- index.ts               #   BY the booking pipeline (QUOTE services) and by pm-requests. NO
   |  |  |- quotes.service.ts      #   routes/controller in MVP -- demo-inbox reads happen via Prisma
   |  |  |- quotes.repository.ts   #   Studio/psql; an authenticated read surface is post-MVP
   |  |  `- quotes.types.ts
   |  |- demo-inbox/               # ROUTELESS internal module: appends FormSubmissionLog rows (the demo
   |  |  |- index.ts               #   inbox feed) after each successful form write -- see
   |  |  |- demo-inbox.service.ts  #   06-pipeline-shared-roadmap.md pipeline step 9
   |  |  `- demo-inbox.repository.ts
   |  |- waitlist/                 # waitlist_signup capture -- FULL listings below (the worked example)
   |  |  |- index.ts
   |  |  |- waitlist.routes.ts
   |  |  |- waitlist.controller.ts
   |  |  |- waitlist.service.ts
   |  |  |- waitlist.repository.ts
   |  |  |- waitlist.validation.ts
   |  |  `- waitlist.types.ts
   |  |- service-area/             # zip allowlist checks
   |  |  |- index.ts
   |  |  |- service-area.routes.ts # GET /zips (the allowlist), GET /validate?zip=27513 -> { eligible }
   |  |  |- service-area.controller.ts
   |  |  |- service-area.service.ts  # wraps shared/service-area zip.validator with the DB-backed list
   |  |  |- service-area.repository.ts
   |  |  |- service-area.validation.ts # zip regex ^\d{5}$
   |  |  `- service-area.types.ts
   |  |- pm-requests/              # property-manager B2B form
   |  |  |- index.ts
   |  |  |- pm-requests.routes.ts  # POST / (public + formRateLimiter)
   |  |  |- pm-requests.controller.ts
   |  |  |- pm-requests.service.ts # creates QuoteRequest(source: PM_FORM) + PMRequest in one transaction
   |  |  |- pm-requests.repository.ts
   |  |  |- pm-requests.validation.ts # company?, units_est, bundle TURNOVER|LISTING_PREP, scope_notes
   |  |  `- pm-requests.types.ts
   |  `- pro-applications/         # Become-an-Apex-Pro form
   |     |- index.ts
   |     |- pro-applications.routes.ts # POST / (public + formRateLimiter)
   |     |- pro-applications.controller.ts
   |     |- pro-applications.service.ts # trades[] must be known service slugs; acknowledgements stored
   |     |                              #   as collected expectations, NEVER verified (PRD)
   |     |- pro-applications.repository.ts
   |     |- pro-applications.validation.ts
   |     `- pro-applications.types.ts
   |- routes/
   |  `- index.ts                  # apiRouter -- mounts every module router under /api/v1 (listing below)
   |- shared/                      # CROSS-BRAND components (foundation spec section 7) -- full inventory
   |  |                            #   owned by 06-pipeline-shared-roadmap.md; placement + import rule below
   |  |- index.ts                  # barrel
   |  |- contracts/                # booking-configurator contract (P14-M2) types + selection validator
   |  |  |- booking-contract.types.ts
   |  |  `- selection.validator.ts
   |  |- reference/
   |  |  `- reference-generator.ts # pure formatter: (brandCode, year, seq) -> "APX-2026-0042";
   |  |                            #   counter persistence stays in bookings.repository
   |  `- service-area/
   |     |- zip.validator.ts       # pure: (zip, allowlist) -> boolean; no DB, no Apex imports
   |     `- allowlist-loader.ts    # fs-based loader for a service-area.v1.json path (NOT a static
   |                               #   import -- the file lives outside src/ and future brands pass
   |                               #   their own path)
   |- types/
   |  |- index.ts                  # barrel
   |  |- common.types.ts           # PaginationMeta, ApiSuccess<T>, ApiFailure, AuthUser (scaffold)
   |  `- express.d.ts              # Request.user?: AuthUser augmentation (post-MVP admin scaffold)
   `- utils/
      |- index.ts                  # barrel
      |- api-error.ts              # ApiError + static factories (badRequest .. notImplemented). One change
      |                            #   from Elevate: EVERY factory takes (message, details?) so 404/400s can
      |                            #   carry errors.code (05-api-and-validation.md, Deviation D-6)
      |- api-response.ts           # sendSuccess(res, data, message, statusCode, meta?) -- verbatim port
      |- async-handler.ts          # promise-rejection -> next(err) wrapper -- verbatim port
      |- pagination.ts             # buildPagination(query) + buildMeta(page, limit, total) -- verbatim port
      |- logger.ts                 # leveled console logger -- verbatim port
      |- slugify.ts                # seed-time slug helper (verbatim port; MVP: seed is the only writer)
      |- tx-retry.ts               # retry wrapper for serialization/deadlock-retryable $transaction errors
      |                            #   (used by the booking transaction; see 06-pipeline-shared-roadmap.md)
      |- jwt.ts                    # post-MVP admin scaffold (jsonwebtoken)
      `- password.ts               # post-MVP admin scaffold (bcryptjs)
```

Notes on tree-level deviations:

- Deviation: no `modules/payments`, no `modules/auth`, no `modules/users`, no `modules/availability`,
  no `modules/reviews`, no `modules/notifications`, no `services/assets/` sub-module -- justified by
  the PRD out-of-scope list (payments, customer accounts, real notifications, real-time availability)
  and the Apex module list pinned in the foundation spec.
- Deviation: `src/shared/` added (Elevate has no such folder) -- justified by the foundation-spec
  section 7 mandate to deposit cross-brand components (zip allowlist, reference generator,
  configurator contract) for future Raleigh brands.
- Deviation: health check is a module, not an inline handler in `routes/index.ts` -- justified by the
  pinned module list; it also keeps `prisma` imports out of `routes/` entirely.

## package.json

Same script set and dependency baseline as `elevate-server`, minus payments and uploads.

```json
{
  "name": "apex-server",
  "version": "0.1.0",
  "private": true,
  "description": "Backend API for Apex Total Home Services (Node.js + Express + TypeScript + Prisma + PostgreSQL). Feature-module architecture mirroring elevate-server.",
  "main": "dist/server.js",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "postinstall": "node scripts/postinstall.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:deploy": "prisma migrate deploy",
    "prisma:studio": "prisma studio",
    "prisma:seed": "tsx prisma/seed.ts",
    "db:push": "prisma db push"
  },
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  },
  "dependencies": {
    "@prisma/client": "^6.1.0",
    "bcryptjs": "^2.4.3",
    "cors": "^2.8.5",
    "dotenv": "^16.4.7",
    "express": "^4.21.2",
    "express-rate-limit": "^7.4.1",
    "helmet": "^8.0.0",
    "jsonwebtoken": "^9.0.2",
    "morgan": "^1.10.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/jsonwebtoken": "^9.0.7",
    "@types/morgan": "^1.9.9",
    "@types/node": "^22.10.5",
    "prisma": "^6.1.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3",
    "vitest": "^2.1.8"
  },
  "engines": {
    "node": "22.x"
  }
}
```

Dependency decisions:

| Package | Elevate | Apex | Rationale |
|---|---|---|---|
| `stripe` | yes | REMOVED | Payments are PRD out-of-scope. Deviation: no stripe dependency, no payments module, no raw-body webhook mount in app.ts -- justified by PRD out-of-scope. |
| `multer` + `@types/multer` | yes | REMOVED | No admin asset uploads in MVP; `config/service-assets.ts` is a static map. |
| `bcryptjs` + `jsonwebtoken` (+ types) | yes | KEPT | Serve the post-MVP admin surface ONLY (auth.ts middleware scaffold, utils/jwt.ts, utils/password.ts). Nothing in the MVP request path uses them. |
| `vitest` | no | ADDED (dev) | The roadmap's phase gates (`06-pipeline-shared-roadmap.md`) hinge on unit suites -- the 240-cell cleaning matrix, the 2-vs-3-device edge, engine parity. Elevate ships no test runner; Apex's pure engine core is exactly the code a runner pays for. |
| everything else | yes | KEPT, same versions | Mirror Elevate: express@4, zod@3, prisma@6, helmet, cors, morgan, express-rate-limit, dotenv, tsx, typescript@5. |

`scripts/postinstall.js` is ported as-is: it is gated on the `RENDER` env var, so it exits
immediately on developer machines and runs `prisma generate` + `tsc` + best-effort
`prisma migrate deploy` on the deploy host. If Apex deploys somewhere other than Render, the gate
variable is the only line to change (owner: backend dev at deploy time).

## tsconfig.json

Ported verbatim from Elevate:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "sourceMap": true,
    "declaration": false,
    "noUnusedLocals": true,
    "noUnusedParameters": false,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

Notes:

- `rootDir: ./src` means `prisma/seed.ts` is OUTSIDE the compiled build; it runs through `tsx`
  (`npm run prisma:seed`), exactly as in Elevate.
- Because seed-data JSON lives under `prisma/`, src code must NEVER statically `import` it (that
  would violate `rootDir`). `shared/service-area/allowlist-loader.ts` reads its JSON path via `fs`
  at call time; at runtime the allowlist source of truth is the `ServiceAreaZip` table anyway
  (seeded from the JSON).
- `strict` + `noUnusedLocals` are on; write code accordingly (no dead imports).
- CommonJS output on Node 22, matching Elevate -- do not switch to ESM; `tsx` handles dev.

## .env.example

Exact key list. Dropped from Elevate: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_PUBLISHABLE_KEY`, `ASSET_STORAGE_DIR`, `SERVICE_ASSETS_FILE`. Added: none.

```bash
# Runtime
NODE_ENV=development
PORT=4000

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/apex?schema=public

# Auth -- post-MVP admin surface ONLY. No MVP request path reads these, but env
# validation requires them (>= 16 chars) so the admin surface can land later
# with zero env churn. Generate random strings; never reuse across envs.
JWT_ACCESS_SECRET=change-me-to-a-random-32-char-string
JWT_REFRESH_SECRET=change-me-to-a-different-random-string
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
BCRYPT_SALT_ROUNDS=10

# HTTP
CORS_ORIGIN=*
RATE_LIMIT_WINDOW_MS=900000
# 300, not Elevate's 100: anonymous configurator traffic fires a price preview per
# selection change (05-api-and-validation.md, Deviation D-8).
RATE_LIMIT_MAX=300
```

### config/env.ts

Elevate's fail-fast pattern, minus the stripe/asset blocks:

```ts
import "dotenv/config";
import { z } from "zod";

/**
 * Validated environment. Importing this module fails fast (process.exit) if any
 * required variable is missing or malformed, so the rest of the app can treat
 * `env` as fully trustworthy and correctly typed.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z
    .string()
    .url("DATABASE_URL must be a valid Postgres connection string"),

  // Post-MVP admin surface only (see middleware/auth.ts scaffold).
  JWT_ACCESS_SECRET: z.string().min(16, "JWT_ACCESS_SECRET must be at least 16 characters"),
  JWT_REFRESH_SECRET: z.string().min(16, "JWT_REFRESH_SECRET must be at least 16 characters"),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),

  CORS_ORIGIN: z.string().default("*"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
  // Default 300 vs Elevate's 100 -- anonymous preview traffic (05, Deviation D-8).
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
export const isDev = env.NODE_ENV === "development";
export const isTest = env.NODE_ENV === "test";
```

## App wiring

### src/app.ts

Wiring order is pinned and mirrors Elevate: helmet -> cors -> json -> (morgan) -> rate limit ->
/api/v1 -> notFound -> errorHandler. Elevate mounts a raw-body Stripe webhook between cors and
json; Apex has no payments, so that mount is gone (see Deviation in the dependency table).

```ts
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env, isProd, isTest } from "./config/env";
import { apiRouter } from "./routes";
import { errorHandler } from "./middleware/error-handler";
import { notFound } from "./middleware/not-found";
import { generalRateLimiter } from "./middleware/rate-limit";

/** Build and configure the Express app. Does not start listening. */
export function createApp() {
  const app = express();

  app.disable("x-powered-by");

  // 1. Security headers
  app.use(helmet());

  // 2. CORS (comma-separated origin list, or "*" -> reflect)
  app.use(
    cors({
      origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(","),
      credentials: true,
    }),
  );

  // (Elevate mounts express.raw() payment webhooks here. Apex has none.)

  // 3. Body parsing
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));

  // 4. Request logging (quiet during tests)
  if (!isTest) {
    app.use(morgan(isProd ? "combined" : "dev"));
  }

  // 5. Rate limiting + versioned API
  app.use("/api", generalRateLimiter);
  app.use("/api/v1", apiRouter);

  // 6. 404 + error handling (must come last)
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
```

### src/server.ts

```ts
import { createApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./db/client";
import { logger } from "./utils/logger";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(
    `apex-server listening on http://localhost:${env.PORT} (${env.NODE_ENV})`,
  );
});

/** Close the HTTP server and DB connections cleanly on shutdown signals. */
async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received -- shutting down`);
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
```

### src/db/client.ts

```ts
import { PrismaClient } from "@prisma/client";
import { env } from "../config/env";

/**
 * Single shared PrismaClient. Reused across dev hot-reloads (via globalThis) so
 * we don't exhaust the database connection pool by creating a new client on
 * every reload.
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
  });

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

Only `*.repository.ts` files (and `prisma/seed.ts`) may import this module. No other layer touches
Prisma -- controllers and services stay persistence-agnostic.

### src/routes/index.ts

```ts
import { Router } from "express";
import { healthRouter } from "../modules/health";
import { servicesRouter } from "../modules/services";
import { bookingsRouter } from "../modules/bookings";
import { waitlistRouter } from "../modules/waitlist";
import { serviceAreaRouter } from "../modules/service-area";
import { pmRequestsRouter } from "../modules/pm-requests";
import { proApplicationsRouter } from "../modules/pro-applications";

/** API v1 router -- aggregates every feature module under one mount point. */
export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/services", servicesRouter);
apiRouter.use("/bookings", bookingsRouter);
apiRouter.use("/waitlist", waitlistRouter);
apiRouter.use("/service-area", serviceAreaRouter);
apiRouter.use("/pm-requests", pmRequestsRouter);
apiRouter.use("/pro-applications", proApplicationsRouter);

// modules/pricing, modules/quotes, and modules/demo-inbox are ROUTELESS:
// consumed by direct service imports (decision #9; 05's 12-endpoint surface
// is the entire MVP). Nothing to mount for them here.
```

The final URL for health is unchanged from Elevate (`GET /api/v1/health`); it moved from an inline
handler into `modules/health` so this file never imports `prisma`.

## The module pattern (explained once)

Every feature module is a folder under `src/modules/` with the same 6-7 files. Request flow:

```
HTTP -> {feature}.routes.ts -> [middleware: rate limit? validate?] -> asyncHandler(controller.method)
     -> {feature}.controller.ts (HTTP concerns only)
     -> {feature}.service.ts    (business logic, serialization, ApiError throws)
     -> {feature}.repository.ts (the ONLY prisma toucher)
     -> PostgreSQL
```

Conventions (all verified against Elevate, see `elevate-conventions.md` extraction; ground truth is
the Elevate source itself):

- `{feature}.routes.ts` -- `export const {feature}Router = Router()`. Applies middleware
  (`validate(...)`, rate limiters; post-MVP: `authenticate`/`authorize`). EVERY handler is wrapped
  in `asyncHandler(...)`. Nested sub-routers use `Router({ mergeParams: true })` and are registered
  by the parent's routes file (e.g. `services.routes.ts` mounts `serviceConfigRouter` at
  `/:idOrSlug/config`).
- `{feature}.controller.ts` -- a `class {Feature}Controller` whose methods are ARROW-FUNCTION
  PROPERTIES (so `this` survives being passed as a handler). HTTP concerns only: pull typed data
  off `req`, call the service, respond via `sendSuccess(res, data, message, HttpStatus.X)`. Exports
  a singleton: `export const {feature}Controller = new {Feature}Controller()`.
- `{feature}.service.ts` -- a `class` holding business logic. Throws `ApiError.*` factories. Owns
  serialization (DB row -> wire DTO). Composes its own repository, other repositories, and other
  module services by DIRECT IMPORT of their singletons. Singleton export.
- `{feature}.repository.ts` -- a `class`; the only layer that imports `db/client`. Thin, mechanical
  methods taking `Prisma.*UncheckedCreateInput` / `WhereInput` types. No business rules, no
  `ApiError`. Singleton export.
- `{feature}.validation.ts` -- zod schemas exported by name (`createXSchema`, `xIdSchema`, ...).
  `z.coerce.*` for query/param coercion, `z.nativeEnum(...)` against `src/enums`,
  `.partial().refine(d => Object.keys(d).length > 0, ...)` for PATCH bodies.
- `{feature}.types.ts` -- DTOs via `z.infer<typeof schema>` plus hand-written response interfaces.
- `index.ts` -- barrel exporting ONLY the router and the service (the module's public surface).
  Other modules import from the barrel, never from deep paths.
- NO dependency-injection container. Plain module imports of pre-instantiated class singletons.
  This is deliberate Elevate parity; do not introduce inversify/awilix/etc.

Reduced modules are allowed where layers have no content: `pricing` has no routes/controller
(routeless internal module -- Elevate's `notifications` is the precedent) and `health` has no
validation/types (no inputs). Every module that accepts input has all seven files.

### Layer-responsibility table (who may import whom)

| Layer | May import | Must NEVER import / do | Responsibility |
|---|---|---|---|
| `*.routes.ts` | own controller, own validation, `middleware/*`, `utils/async-handler` | `db/client`, repositories, business logic inline | URL map, middleware chain, handler wiring |
| `*.controller.ts` | own service, own types, `utils/api-response`, `utils/api-error`, `constants/http-status` | `db/client`, any repository, zod parsing (validate middleware already ran) | HTTP in/out, status codes, envelope |
| `*.service.ts` | own + other repositories, OTHER module barrels (services), `shared/*`, `utils/*`, `enums`, `constants`, own types | `db/client` directly, `express` types (no req/res) | Business rules, cross-module composition, ApiError throws, serialization |
| `*.repository.ts` | `db/client`, `@prisma/client` types | business rules, `ApiError`, express, other modules | All Prisma queries/writes for its models |
| `*.validation.ts` | `zod`, `enums`, `shared/contracts` schemas | `db/client`, express | Transport-shape validation only (layer 1 of the 3-layer validation model, see `05-api-and-validation.md`) |
| `*.types.ts` | `z.infer` of own validation, `@prisma/client` types (type-only) | runtime code | DTO + response typing |
| `index.ts` (barrel) | own routes + own service | anything else | Public module surface: router + service |
| `src/shared/*` | other `shared/*` files, node stdlib, `zod` | `modules/*`, `db/*`, `config/*`, `middleware/*`, `utils/*`, `enums` (Prisma-generated) | Brand-neutral, extractable components |

One model, one writer: each Prisma model has exactly one repository that writes it (e.g.
`Booking`, `BookingConfiguration`, and `BookingReferenceCounter` are written only by
`bookings.repository.ts`; `QuoteRequest` rows are written by `quotes.repository.ts`, which
`bookingsService` and `pmRequestsService` call through `quotesService`). Cross-module READS go
through the owning module's service, not its repository.

## Worked example: the waitlist module (full listings)

The smallest full-pattern module. Model (fields pinned in the foundation spec; full schema in
`02-database.md`): `WaitlistSignup { id, brand Brand @default(APEX), email, zip, source
WaitlistSource, status WaitlistStatus @default(ACTIVE), createdAt, updatedAt, @@unique([email, zip]) }`.

Behavior contract (PRD): a zip-allowlist miss must NEVER dead-end. So `POST /waitlist` is public,
idempotent on `[email, zip]`, and a duplicate submit is a SUCCESS that returns the existing record.

Deviation: duplicate waitlist submits return 200 with the existing signup instead of Elevate's 409
on an ACTIVE duplicate -- justified by the PRD "never a dead end" acceptance criterion and the
foundation-spec `@@unique([email, zip])` absorb-double-submits semantics.

Deviation: no `authenticate` on the router (Elevate's waitlist requires auth) -- this is pinned
deviation 3 (anonymous booking): Apex MVP has no customer accounts, so all form endpoints are
public + rate-limited.

### modules/waitlist/waitlist.validation.ts

```ts
import { z } from "zod";
import { WaitlistSource } from "../../enums";

/**
 * POST /waitlist -- public capture. Direct submits (the /service-area page)
 * default to SERVICE_AREA_PAGE; the booking pipeline's zip-miss arm calls
 * waitlistService.signup() directly with SERVICE_AREA_MISS.
 */
/**
 * The PRD publishes kebab wire values ("service-area-miss", "service-area-page");
 * map them onto the Prisma enum via z.preprocess (Elevate's lowercase-brand
 * preprocess precedent). Bare enum values also pass for internal callers.
 */
export const waitlistSourceSchema = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toUpperCase().replace(/-/g, "_") : v),
  z.nativeEnum(WaitlistSource),
);

export const createWaitlistSignupSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  zip: z.string().regex(/^\d{5}$/, "zip must be a 5-digit ZIP code"),
  source: waitlistSourceSchema.default(WaitlistSource.SERVICE_AREA_PAGE),
});
```

### modules/waitlist/waitlist.types.ts

```ts
import type { z } from "zod";
import type { createWaitlistSignupSchema } from "./waitlist.validation";

export type CreateWaitlistSignupDto = z.infer<typeof createWaitlistSignupSchema>;

/** PRD waitlist_signup contract shape (snake_case on the wire). */
export interface WaitlistSignupResponse {
  signup_id: string;
  brand: string; // "apex"
  email: string;
  zip: string;
  source: string; // "service-area-miss" | "service-area-page"
  created_at: string; // ISO-8601
}

/** Wire `data` shape for POST /waitlist (pinned by 05-api-and-validation.md 5.8). */
export interface WaitlistSignupResult {
  waitlist_signup: WaitlistSignupResponse;
  created: boolean; // false on the idempotent duplicate path (analytics signal)
}
```

### modules/waitlist/waitlist.repository.ts

```ts
import { prisma } from "../../db/client";
import type { Prisma } from "@prisma/client";

export class WaitlistRepository {
  findByEmailZip(email: string, zip: string) {
    return prisma.waitlistSignup.findUnique({
      where: { email_zip: { email, zip } },
    });
  }
  create(data: Prisma.WaitlistSignupUncheckedCreateInput) {
    return prisma.waitlistSignup.create({ data });
  }
}

export const waitlistRepository = new WaitlistRepository();
```

### modules/waitlist/waitlist.service.ts

```ts
import { Prisma } from "@prisma/client";
import type { WaitlistSignup } from "@prisma/client";
import { waitlistRepository } from "./waitlist.repository";
import { WaitlistSource } from "../../enums";
import type {
  CreateWaitlistSignupDto,
  WaitlistSignupResponse,
} from "./waitlist.types";

/** Prisma enum -> PRD wire value. */
const SOURCE_WIRE: Record<WaitlistSource, string> = {
  [WaitlistSource.SERVICE_AREA_MISS]: "service-area-miss",
  [WaitlistSource.SERVICE_AREA_PAGE]: "service-area-page",
};

export class WaitlistService {
  /**
   * Idempotent capture. @@unique([email, zip]) absorbs double-submits: a
   * duplicate returns the existing signup as a SUCCESS (created: false) -- the
   * PRD forbids dead-ending the zip-miss flow, so no 409 here. (Elevate's
   * waitlist 409s on an ACTIVE duplicate; see the Deviation note above.)
   *
   * Also consumed by bookingsService for the WAITLISTED arm of POST /bookings
   * (source: SERVICE_AREA_MISS) -- see 06-pipeline-shared-roadmap.md.
   */
  async signup(
    dto: CreateWaitlistSignupDto,
  ): Promise<{ signup: WaitlistSignupResponse; created: boolean }> {
    const existing = await waitlistRepository.findByEmailZip(dto.email, dto.zip);
    if (existing) {
      return { signup: this.serialize(existing), created: false };
    }
    try {
      const row = await waitlistRepository.create({
        email: dto.email,
        zip: dto.zip,
        source: dto.source,
      });
      return { signup: this.serialize(row), created: true };
    } catch (err) {
      // Race: another request inserted [email, zip] between find and create.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const row = await waitlistRepository.findByEmailZip(dto.email, dto.zip);
        if (row) return { signup: this.serialize(row), created: false };
      }
      throw err;
    }
  }

  /** DB row -> PRD waitlist_signup contract (snake_case wire shape). */
  private serialize(row: WaitlistSignup): WaitlistSignupResponse {
    return {
      signup_id: row.id,
      brand: row.brand.toLowerCase(), // Brand.APEX -> "apex"
      email: row.email,
      zip: row.zip,
      source: SOURCE_WIRE[row.source],
      created_at: row.createdAt.toISOString(),
    };
  }
}

export const waitlistService = new WaitlistService();
```

### modules/waitlist/waitlist.controller.ts

```ts
import type { Request, Response } from "express";
import { waitlistService } from "./waitlist.service";
import { sendSuccess } from "../../utils/api-response";
import { HttpStatus } from "../../constants/http-status";
import type { CreateWaitlistSignupDto } from "./waitlist.types";

export class WaitlistController {
  create = async (req: Request, res: Response) => {
    const { signup, created } = await waitlistService.signup(
      req.body as CreateWaitlistSignupDto,
    );
    // data shape { waitlist_signup, created } is pinned by 05-api-and-validation.md 5.8
    // (the WAITLISTED booking arm nests waitlist_signup the same way).
    sendSuccess(
      res,
      { waitlist_signup: signup, created },
      created ? "Joined the waitlist" : "Already on the waitlist",
      created ? HttpStatus.CREATED : HttpStatus.OK,
    );
  };
}

export const waitlistController = new WaitlistController();
```

### modules/waitlist/waitlist.routes.ts

```ts
import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { validate } from "../../middleware/validate";
import { formRateLimiter } from "../../middleware/rate-limit";
import { waitlistController } from "./waitlist.controller";
import { createWaitlistSignupSchema } from "./waitlist.validation";

export const waitlistRouter = Router();

// PUBLIC by design (pinned deviation 3: no customer accounts in MVP). Every
// public form POST carries the stricter formRateLimiter on top of the general
// /api limiter.
waitlistRouter.post(
  "/",
  formRateLimiter,
  validate({ body: createWaitlistSignupSchema }),
  asyncHandler(waitlistController.create),
);
```

### modules/waitlist/index.ts

```ts
export { waitlistRouter } from "./waitlist.routes";
export { waitlistService } from "./waitlist.service";
```

### Wire example

Request:

```http
POST /api/v1/waitlist
Content-Type: application/json

{ "email": "sam@example.com", "zip": "27601" }
```

Response (201; a repeat submit returns 200 with the same `data` and message
"Already on the waitlist"):

```json
{
  "success": true,
  "message": "Joined the waitlist",
  "data": {
    "waitlist_signup": {
      "signup_id": "0d2f7a3e-9d1c-4b8a-b1f2-3c4d5e6f7a8b",
      "brand": "apex",
      "email": "sam@example.com",
      "zip": "27601",
      "source": "service-area-page",
      "created_at": "2026-07-06T14:32:11.000Z"
    },
    "created": true
  }
}
```

The full endpoint catalog with more examples lives in `05-api-and-validation.md`.

## Middleware inventory

| File | Exports | Purpose | MVP status |
|---|---|---|---|
| `middleware/validate.ts` | `validate({ body?, query?, params? })` | Parses request parts with zod and REPLACES `req.body/query/params` with the parsed (coerced/defaulted) output so controllers get typed data. ZodError -> `ApiError.unprocessable("Validation failed", { code: "VALIDATION_FAILED", issues })` where issues = `error.issues.map(i => ({ path: i.path.join("."), message: i.message }))` (HTTP 422). The `{ code, issues }` wrapper is 05's Deviation D-6 (Elevate emits the bare issues array) so `errors.code` is present on every 4xx. Because `req.params` is replaced, every param schema must list EVERY param on its route (including merged parent params). | Active on every route with input |
| `middleware/error-handler.ts` | `errorHandler` | Global translator, registered LAST (4-arg signature). ApiError -> its status + details; ZodError -> 422 per-issue details; Prisma P2002 -> 409 "already exists"; P2025 -> 404 "Record not found"; other known Prisma -> 400; other Error -> 500. Failure envelope `{ success: false, message, errors?, stack? }` (stack only when not prod). Logs via `logger.error` only when status >= 500. | Active |
| `middleware/not-found.ts` | `notFound` | 404 fallback: `{ success: false, message: "Not found: METHOD url" }`. Registered after all routes, before errorHandler. | Active |
| `middleware/rate-limit.ts` | `generalRateLimiter`, `previewRateLimiter`, `formRateLimiter`, `lookupRateLimiter` | `generalRateLimiter`: env-driven window/max (default 300 -- D-8), mounted app-wide at `/api`; 429 body uses the failure envelope. Three hardcoded route limiters on top (mirrors Elevate's hardcoded `authRateLimiter` at 10): `previewRateLimiter` (120/15 min) on `POST /services/:idOrSlug/config/price` -- the configurator fires a preview per selection change, so it gets its own generous ceiling; `formRateLimiter` (20/15 min) on the four form POSTs `/bookings`, `/waitlist`, `/pm-requests`, `/pro-applications`; `lookupRateLimiter` (30/15 min) on `GET /bookings/:reference` (anti-enumeration). Values pinned in `05-api-and-validation.md`. | Active |
| `middleware/auth.ts` | `authenticate`, `optionalAuthenticate`, `authorize` | JWT scaffold ported from Elevate (verifies via `utils/jwt.ts`, attaches `req.user`). GUARDS NOTHING IN MVP -- no route imports it. Exists so the post-MVP admin surface (config CRUD, demo-inbox auth) bolts on without touching module structure. | Scaffold only |
| `middleware/index.ts` | barrel | `export * from` each middleware file. | Active |

Deviation: Elevate splits auth into `authenticate.ts` + `authorize.ts`; Apex collapses both into a
single `auth.ts` scaffold -- justified by the foundation spec's pinned middleware list
("auth.ts scaffold, unused in MVP"); it splits back out if the admin surface grows.

## src/shared/ -- cross-brand components and the import-direction rule

`src/shared/` sits NEXT TO `src/modules/` and holds the components Apex deposits for future
Raleigh brands (foundation spec section 7). The full inventory, per-component API, and the
"how a future brand consumes this" notes are owned by `06-pipeline-shared-roadmap.md`; this section fixes
placement and the dependency rule.

| Pinned shared boundary | Home | Note |
|---|---|---|
| Pricing engine core + rules evaluator | `modules/pricing/engine/` | Path pinned by the foundation spec; the folder obeys the shared import rule below even though it lives inside a module |
| Configuration contract types + selection validator | `shared/contracts/` | Types mirror the P14-M2 booking-configurator contract |
| Booking reference generator | `shared/reference/reference-generator.ts` | Pure `(brandCode, year, seq) -> "APX-2026-0042"` formatting; counter persistence stays in `bookings.repository.ts` |
| Zip validator + allowlist loader | `shared/service-area/` | Pure functions; `prisma/seed-data/service-area.v1.json` is THE shared Raleigh data file |
| Waitlist module | `modules/waitlist` | A clearly-bounded module rather than a shared lib; the `brand` column keeps records multi-brand |
| API envelope / error / validate utilities | `src/utils` + `src/middleware` | Already brand-neutral verbatim Elevate ports; extracted as-is when a second brand server exists |

The import-direction rule (enforced by convention and code review in MVP; an ESLint
`no-restricted-imports` rule is a cheap add when linting lands -- owner: backend dev):

1. `shared/` (and `modules/pricing/engine/`) may import ONLY: other files in the same boundary,
   the Node standard library, and `zod`. NEVER from `modules/`, `db/`, `config/`, `middleware/`,
   `utils/`, or `enums/`.
2. In particular, shared code never imports Prisma-generated types or enums -- those encode the
   Apex schema. Shared types are standalone literal unions; module services own the mapping between
   Prisma enums and wire values (see `SOURCE_WIRE` in the waitlist service for the pattern).
3. Shared code never throws `ApiError` (that is an app concern); it returns result objects or
   throws plain typed errors that module services translate.
4. `modules/*` may import from `shared/` freely. The reverse direction is forbidden: shared never
   imports from modules.
5. The extraction test: any `shared/` folder (or the pricing engine folder) must be copyable into a
   future brand's repo, or an npm workspace package, with zero edits.

## Deviations from Elevate (summary for this section)

Called out inline above; collected here. The four foundation-spec-pinned deviations are marked (P).

| Deviation | Justification | Owned by |
|---|---|---|
| (P3) `POST /bookings` and all form endpoints are PUBLIC + rate-limited; no `authenticate` on any MVP route | PRD: customer accounts are out of scope; contact is snapshotted per booking. Auth exists only as a scaffold for the post-MVP admin surface | This file (routes/middleware), `05-api-and-validation.md` |
| No stripe/multer deps, no payments/auth/users/availability/reviews/notifications/assets modules, no raw-body webhook mount, stripe/asset env keys dropped | PRD out-of-scope: payments, uploads, accounts, real notifications, real-time availability | This file |
| Health check is `modules/health`, not an inline `routes/index.ts` handler | Foundation-spec pinned module list; keeps `prisma` imports out of `routes/` (repository-only rule stays absolute) | This file |
| Duplicate waitlist submit -> idempotent 200 success instead of 409 | PRD "never a dead end" + foundation-spec `@@unique([email, zip])` absorb semantics | This file |
| `src/shared/` folder added (Elevate has none) | Foundation-spec section 7: Apex deposits cross-brand components for future Raleigh brands | This file, `06-pipeline-shared-roadmap.md` |
| Single `middleware/auth.ts` scaffold instead of `authenticate.ts` + `authorize.ts` | Foundation-spec pinned middleware list; nothing guards MVP routes | This file |
| `formRateLimiter`/`previewRateLimiter`/`lookupRateLimiter` replace Elevate's single `authRateLimiter` role; `RATE_LIMIT_MAX` default raised 100 -> 300 | No auth writes exist to protect; public form POSTs, the per-selection price preview, and reference lookups are three different abuse surfaces with different legitimate rates (05's D-8) | This file, `05-api-and-validation.md` |
| Every `ApiError` factory takes `(message, details?)` (Elevate's `notFound`/`badRequest` take only `message`) | 05's catalog requires `errors.code` on every operational 4xx, including 404/400 | This file (`utils/api-error.ts`), `05-api-and-validation.md` |
| `vitest` added as a devDependency (Elevate ships no test runner) | The roadmap's phase gates run the 240-cell matrix, 2-vs-3-device, and engine-parity suites against the pure engine core | This file, `06-pipeline-shared-roadmap.md` |
| (P1) Booking reference `APX-YYYY-NNNN` via `BookingReferenceCounter` instead of random `BK-{time36}-{hex}` | PRD-mandated reference format; sequential + collision-safe | `02-database.md`, `06-pipeline-shared-roadmap.md` |
| (P2) Rich pricing engine ported SERVER-side (Elevate keeps it client-side and does additive option math on the server) | Matrix/percent/threshold pricing cannot be expressed additively; server recompute is the integrity guard | `03-pricing-engine.md` |
| (P4) Config price preview body `{ selections, quantity? }` instead of `{ optionIds }` | Keyed selections are required for matrix/quantity semantics per the P14-M2 contract | `05-api-and-validation.md` |

## Open questions (product owner)

1. `formRateLimiter` threshold: 20 requests per `RATE_LIMIT_WINDOW_MS` per IP is this section's
   proposal. Confirm or tune before launch (owner: product owner).
2. RESOLVED during review: the demo inbox has NO read endpoints in MVP -- `modules/quotes` and
   `modules/demo-inbox` are routeless (decision #9); reads happen via Prisma Studio/psql, and an
   authenticated read surface is post-MVP (`05-api-and-validation.md` pins the 12-endpoint surface).
3. Deploy target: `scripts/postinstall.js` assumes a Render-class host. If Apex deploys elsewhere,
   the env-var gate changes (owner: backend dev at deploy time).
4. JWT env keys are required-but-unused in MVP (Elevate parity). If ops prefers, they can be made
   `.optional()` until the admin surface lands (owner: product owner / ops).
