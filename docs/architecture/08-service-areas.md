# Service areas, ZIP codes & service availability

Section 08. Replaces the flat `ServiceAreaZip` allowlist (docs 02) with a normalized,
admin-managed geography model and a **grant + override** availability system. Written as a senior
design: it recommends a model that differs from the naive two-join-table proposal and explains why.

## 0. Recommendation (TL;DR)

- **Geography is normalized**: `Area` 1→N `ZipCode`. A ZIP belongs to exactly one area.
- **Availability is grant + override, not two inclusion joins:**
  - `ServiceArea(serviceId, areaId)` — an **area-level grant**: the service covers the *whole* area
    (every ZIP in it) by default.
  - `ServiceZipCoverage(serviceId, zipCodeId, effect INCLUDE|EXCLUDE)` — a **per-ZIP override** that
    beats the area grant (most-specific-wins).
- **Why not two inclusion tables** (the proposed `ServiceArea` + `ServiceZipCode`): inclusion-only
  joins cannot express *"available in Dallas but excluded from 75002"* (Scenario 1) without
  abandoning the whole-area grant and listing every ZIP by hand. An `effect` override handles all
  three scenarios with O(1) rules.
- **ZIPs are globally unique among active rows** (one ZIP → one area) so booking resolution is
  deterministic. (The requirement only asked for unique-within-area; global uniqueness is the
  stronger, safer guarantee and is what makes `zip → area → availability` unambiguous.)
- **Soft delete everywhere** (`deletedAt`) + `status ACTIVE|INACTIVE`. Deleted rows keep history and
  free their name/code for reuse (enforced by partial unique indexes on `deletedAt IS NULL`).

## 1. Schema

```prisma
enum GeoStatus { ACTIVE INACTIVE }
enum CoverageEffect { INCLUDE EXCLUDE }

model Area {
  id        String    @id @default(uuid())
  name      String
  slug      String
  status    GeoStatus @default(ACTIVE)
  deletedAt DateTime?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  zipCodes     ZipCode[]
  serviceAreas ServiceArea[]
  @@index([status, deletedAt])
  // + partial unique indexes (raw SQL migration): UNIQUE(name) / UNIQUE(slug) WHERE deleted_at IS NULL
}

model ZipCode {
  id        String    @id @default(uuid())
  areaId    String
  zipCode   String
  city      String?
  state     String?
  status    GeoStatus @default(ACTIVE)
  deletedAt DateTime?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  area     Area                 @relation(fields: [areaId], references: [id], onDelete: Restrict)
  coverage ServiceZipCoverage[]
  @@index([areaId, status, deletedAt])
  @@index([zipCode])
  // + partial unique index: UNIQUE(zip_code) WHERE deleted_at IS NULL  (one active ZIP -> one area)
}

model ServiceArea {         // area-level GRANT (whole area, all ZIPs)
  id        String   @id @default(uuid())
  serviceId String
  areaId    String
  createdAt DateTime @default(now())
  service Service @relation(fields: [serviceId], references: [id], onDelete: Cascade)
  area    Area    @relation(fields: [areaId], references: [id], onDelete: Cascade)
  @@unique([serviceId, areaId])
  @@index([areaId])
}

model ServiceZipCoverage {  // per-ZIP OVERRIDE (wins over the area grant)
  id        String         @id @default(uuid())
  serviceId String
  zipCodeId String
  effect    CoverageEffect
  createdAt DateTime       @default(now())
  updatedAt DateTime       @updatedAt
  service Service @relation(fields: [serviceId], references: [id], onDelete: Cascade)
  zipCode ZipCode @relation(fields: [zipCodeId], references: [id], onDelete: Cascade)
  @@unique([serviceId, zipCodeId])
  @@index([zipCodeId])
}
```

`Service` gains `serviceAreas ServiceArea[]` and `zipCoverage ServiceZipCoverage[]`.

## 2. ER diagram

```
 Service ─1─┐                              ┌─N ZipCode ─N─┐
            │                              │   (areaId)   │
            ├─N ServiceArea N─┬─ Area ─1───┘              │
            │   (grant)       │  (name/slug, status,      │
            │                 │   soft-delete)            │
            └─N ServiceZipCoverage N───────────────────────┘
                (effect INCLUDE|EXCLUDE, per-ZIP override)
```

## 3. Entity relationships

| FK | Cardinality | onDelete | Why |
|---|---|---|---|
| `ZipCode.areaId → Area.id` | N:1 | Restrict | An area with ZIPs can't be hard-deleted; retire via status / soft-delete. |
| `ServiceArea.serviceId → Service.id` | N:1 | Cascade | A grant is meaningless without its service. |
| `ServiceArea.areaId → Area.id` | N:1 | Cascade | Grant removed if the area is truly deleted. |
| `ServiceZipCoverage.serviceId → Service.id` | N:1 | Cascade | Override owned by the service. |
| `ServiceZipCoverage.zipCodeId → ZipCode.id` | N:1 | Cascade | Override owned by the ZIP. |

## 4. API design

**Admin (capability `geo:manage`, coordinator + admin):**

| Method | Path | Purpose |
|---|---|---|
| GET | `/admin/areas?search=&status=&includeDeleted=&page=&limit=` | List (search + paginate) |
| POST | `/admin/areas` | Create (dedupe name) |
| PATCH | `/admin/areas/:id` | Rename / set status |
| DELETE | `/admin/areas/:id` | Soft-delete |
| POST | `/admin/areas/:id/restore` | Undo soft-delete |
| GET | `/admin/zip-codes?areaId=&search=&status=&page=&limit=` | List (filter by area) |
| POST | `/admin/zip-codes` | Create (assign area, dedupe code) |
| PATCH | `/admin/zip-codes/:id` | Edit / reassign area / status |
| DELETE | `/admin/zip-codes/:id` | Soft-delete |
| GET | `/admin/coverage/:serviceId` | Current grants + overrides + the area/ZIP tree for the editor |
| PUT | `/admin/coverage/:serviceId` | Replace coverage atomically `{ areaIds[], zipOverrides:[{zipCodeId,effect}] }` |

**Public:**

| Method | Path | Purpose |
|---|---|---|
| GET | `/service-area/areas` | Active areas + their active ZIPs (the /service-area page) |
| GET | `/service-area/validate?zip=NNNNN[&service=slug]` | Zip gate; with `service`, full availability |

Envelope + pagination reuse the existing `sendSuccess`/`buildMeta`.

## 5. Admin UI / UX flow

- **Areas**: searchable, paginated table; create/edit inline; activate/deactivate; soft-delete +
  restore. Duplicate names blocked with an inline error.
- **ZIP Codes**: area filter + search + pagination; create (choose area) / edit / reassign / status /
  soft-delete. Duplicate active codes blocked.
- **Coverage editor** (per service): pick a service → areas render as checkboxes (checked = whole-area
  grant). Expand an area to see its ZIPs as a **tri-state**: *Default* (follows the area), *Included*,
  *Excluded*. Save issues one `PUT /admin/coverage/:serviceId`. For thousands of ZIPs: server-side
  search within an area + lazy expansion (virtualization is a later enhancement).

## 6. Booking validation flow

`isServiceAvailable(serviceId, zip)`:
1. Look up an **active, non-deleted** `ZipCode` by code, joined to its area. None → `We don't serve
   that ZIP yet` (offer waitlist).
2. Area must be **ACTIVE + not deleted** → else `Not serving your area yet`.
3. **Override wins**: if a `ServiceZipCoverage(serviceId, zip)` exists → `INCLUDE` ⇒ available,
   `EXCLUDE` ⇒ `This service isn't offered at your ZIP`.
4. Else **area grant**: `ServiceArea(serviceId, zip.areaId)` exists ⇒ available, else
   `This service isn't offered in your area yet`.

Returns `{ available, area?, reason? }`. The `POST /bookings` pipeline calls this before pricing;
out-of-area is a waitlist signup, not an error (unchanged zip-gate philosophy).

## 7. Migration plan (for a live deployment)

The server here is pre-first-migration, so this is a **clean replacement**. For a live system that
already has flat `ServiceAreaZip` rows:

1. **Additive migration**: create `Area`, `ZipCode`, `ServiceArea`, `ServiceZipCoverage`; keep
   `ServiceAreaZip` in place. No downtime.
2. **Backfill**: create a default `Area` (e.g. "Wake County") and copy each `ServiceAreaZip` → a
   `ZipCode` under it, preserving `active → status`. Because MVP availability was global (any active
   ZIP served every service), grant every active service a `ServiceArea` for the default area — this
   reproduces prior behavior exactly.
3. **Dual-read**: point validation at the new resolver behind a flag; compare against the old path in
   logs until confidence is high.
4. **Cutover**: flip the flag; stop writing `ServiceAreaZip`.
5. **Drop**: remove `ServiceAreaZip` in a later migration once nothing reads it.

## 8. Architecture options & trade-offs

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **A. Two inclusion joins** (proposed) | Simplest; FK-clean | **Can't express exclusions** (Scenario 1); whole-area grant impossible without listing every ZIP | Rejected |
| **B. Grant + override** (chosen) | Covers all 3 scenarios; whole-area grant is one row; FK-clean; matches the checkbox+tri-state UI | Two tables; resolution has a precedence rule | **Chosen** |
| **C. Generalized coverage rules** `(scopeType, scopeId, effect, priority)` | One table for area/ZIP *and* future state/city/county/zone; add a scope = add an enum value | Polymorphic `scopeId` (no FK integrity); precedence logic; harder admin mental model | Future path (see §9) |

B is the sweet spot now: it is exactly C restricted to two concrete, FK-backed scopes. Migrating
B→C later is mechanical (fold `ServiceArea`→rule(AREA,ALLOW), `ServiceZipCoverage`→rule(ZIP,effect)).

## 9. Recommended improvements & future scalability

- **Generalized coverage rules (C)** when a 3rd scope arrives (state/city/county/neighborhood/zone):
  a single `ServiceCoverageRule(serviceId, scopeType, scopeId, effect)` resolved most-specific-first.
  Geography itself normalizes further as `Country → State → County → City → Area → ZipCode` with each
  level optional; `ZipCode.areaId` becomes one of several optional parents.
- **Dynamic pricing / fees by area or ZIP**: a `GeoPriceModifier(scopeType, scopeId, kind, value)`
  consumed by the pricing engine's fee slot — the engine already supports fee/discount line items,
  so this is data, not code.
- **Technician coverage / operating hours / service radius**: model as their own scoped tables
  (`TechnicianZip`, `AreaHours`, `ServiceRadius`) keyed to `Area`/`ZipCode` — the normalized geo core
  makes each an additive join, no refactor.
- **Performance at scale**: resolution is 2–3 indexed point lookups; add a covering index on
  `ZipCode(zipCode) WHERE deleted_at IS NULL` and cache `zip → {areaId, status}` (rarely changes).
- **Bulk ZIP import**: a CSV import endpoint per area (thousands of ZIPs) is the natural admin
  companion to the CRUD UI.
