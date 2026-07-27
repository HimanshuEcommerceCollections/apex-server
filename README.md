# apex-server

Backend API for **Apex Total Home Services** — Node.js + Express + TypeScript + Prisma +
PostgreSQL, built as feature modules (mirrors `elevate-server`) and extended with accounts, RBAC,
Stripe payments, and an admin-controlled catalog per
[`docs/architecture/07-platform-evolution.md`](docs/architecture/07-platform-evolution.md).

The full design blueprint lives in [`docs/architecture/`](docs/architecture/) (sections 01–07).
Read `01-foundations.md` first; it owns the repo layout, module pattern, and app wiring.

## Prerequisites

- Node.js ≥ 22
- PostgreSQL 14+ (a `DATABASE_URL` you can reach)

## Setup

```bash
cp .env.example .env          # then fill in DATABASE_URL and the JWT secrets
npm install                   # runs prisma generate via postinstall on deploy hosts
npm run prisma:generate       # generate the Prisma client locally
npm run prisma:migrate        # create + apply the initial migration
npm run prisma:seed           # (once seed-data + seed.ts land) load catalog/pricing/zips
npm run dev                   # tsx watch on http://localhost:4000
```

Health check: `GET http://localhost:4000/api/v1/health`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Watch-mode dev server (`tsx`) |
| `npm run build` / `npm start` | Compile to `dist/` / run compiled server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` / `npm run format` | ESLint (incl. the shared-boundary import rule) / Prettier |
| `npm test` | Vitest suites |
| `npm run prisma:*` | `generate` / `migrate` / `deploy` / `studio` / `seed` |

## Conventions (enforced)

- **Money is always integer cents** — no floats anywhere.
- **One model, one writer** — only a module's `*.repository.ts` touches Prisma for its models.
- **Layered modules** — `routes → controller → service → repository`; see `01-foundations.md`.
- **Shared boundary** — `src/shared/**` and `src/modules/pricing/engine/**` import only
  same-boundary files, the Node stdlib, and `zod` (enforced by ESLint `no-restricted-imports`).

## Build status (roadmap — `07` §11)

| Phase | Scope | Status |
|---|---|---|
| 0 | Foundation: config, app wiring, shared infra, full schema, auth scaffold | ✅ done |
| 1 | `modules/auth` + `modules/users`, sessions, rotation/reuse-detection | ✅ done |
| 2 | `EmailService` (Resend/Gmail SMTP), verification / reset / invite | ✅ done |
| 3 | RBAC (`/admin`, `/me`), professionals, crews, payroll | ⬜ |
| 4 | Catalog draft→publish (`CatalogVersion`), seed→bootstrap | ⬜ |
| 5 | Stripe payments + webhook + brand isolation + refunds | ⬜ |
| 6 | Memberships (subscriptions, per-cycle recompute, fulfillment) | ⬜ |
| 7 | Staff MFA, GDPR, reconciliation | ⬜ |
| 8 | API-driven client migration | ⬜ |

Also implemented in Phase 0 as the worked module examples: `modules/health`, `modules/waitlist`.
