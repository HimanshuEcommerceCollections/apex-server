// One-off, idempotent reshape: Area was seeded as a REGION ("Wake County") with a
// single response-time label, so every town on the home page's Service Coverage
// section rendered the same duration. An Area is meant to be a CITY -- one row per
// serving city, each with its own duration -- which is the shape AREAS now holds.
//
// Safe to re-run. Existing ZipCode rows are MOVED (areaId updated in place, ids
// preserved) so ServiceZipCoverage per-ZIP overrides survive; nothing is hard-
// deleted. Retired areas are soft-deleted only once they hold no ZIPs.
//
//   cd server && npx tsx prisma/reshape-areas.ts [--dry-run]

import { PrismaClient, GeoStatus } from "@prisma/client";
import { AREAS, RETIRED_AREA_SLUGS } from "./seed-data";

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");

/** Fails loudly BEFORE any write: a ZIP may belong to exactly one city. */
function validate(): void {
  const errors: string[] = [];
  const seenZip = new Map<string, string>();
  const seenSlug = new Set<string>();
  for (const a of AREAS) {
    if (seenSlug.has(a.slug)) errors.push(`duplicate area slug "${a.slug}"`);
    seenSlug.add(a.slug);
    if (!a.duration) errors.push(`${a.slug}: missing duration label`);
    for (const z of a.zips) {
      if (!/^\d{5}$/.test(z.zipCode)) errors.push(`${a.slug}: bad ZIP "${z.zipCode}"`);
      const owner = seenZip.get(z.zipCode);
      if (owner) errors.push(`ZIP ${z.zipCode} claimed by both "${owner}" and "${a.slug}"`);
      seenZip.set(z.zipCode, a.slug);
    }
  }
  for (const slug of RETIRED_AREA_SLUGS) {
    if (seenSlug.has(slug)) errors.push(`"${slug}" is both retired and active`);
  }
  if (errors.length) {
    console.error("Validation failed:\n  " + errors.join("\n  "));
    process.exit(1);
  }
}

async function main(): Promise<void> {
  validate();
  console.log(
    `${DRY_RUN ? "[dry-run] " : ""}Reshaping ${AREAS.length} city areas / ` +
      `${AREAS.reduce((n, a) => n + a.zips.length, 0)} ZIPs`,
  );

  const areaIds = new Map<string, string>();

  for (const a of AREAS) {
    const existing = await prisma.area.findFirst({ where: { slug: a.slug, deletedAt: null } });
    const data = { name: a.name, slug: a.slug, duration: a.duration ?? null, status: GeoStatus.ACTIVE };

    if (DRY_RUN) {
      console.log(`  ${existing ? "update" : "create"} area ${a.name} (${a.duration})`);
      areaIds.set(a.slug, existing?.id ?? `dry-${a.slug}`);
    } else {
      // Unlike the seed, this DOES overwrite `duration` -- restoring the per-city
      // labels is the whole point of the reshape.
      const area = existing
        ? await prisma.area.update({ where: { id: existing.id }, data })
        : await prisma.area.create({ data });
      areaIds.set(a.slug, area.id);
    }

    let moved = 0;
    let created = 0;
    for (const z of a.zips) {
      const zip = await prisma.zipCode.findFirst({ where: { zipCode: z.zipCode, deletedAt: null } });
      if (zip) {
        if (zip.areaId !== areaIds.get(a.slug)) moved++;
        if (!DRY_RUN) {
          await prisma.zipCode.update({
            where: { id: zip.id }, // move in place -- keeps ServiceZipCoverage overrides
            data: { areaId: areaIds.get(a.slug)!, city: z.city, state: z.state, status: GeoStatus.ACTIVE },
          });
        }
      } else {
        created++;
        if (!DRY_RUN) {
          await prisma.zipCode.create({
            data: {
              areaId: areaIds.get(a.slug)!,
              zipCode: z.zipCode,
              city: z.city,
              state: z.state,
              status: GeoStatus.ACTIVE,
            },
          });
        }
      }
    }
    console.log(`  ${a.name.padEnd(15)} ${a.duration}  (${moved} moved, ${created} new)`);
  }

  // Every active service covers every city -- matches the seed's DEFAULT_COVERAGE
  // fallback, so the new cities are bookable rather than silently unserviceable.
  const services = await prisma.service.findMany({ select: { id: true } });
  let grants = 0;
  for (const s of services) {
    for (const areaId of areaIds.values()) {
      if (DRY_RUN) {
        grants++;
        continue;
      }
      const { count } = await prisma.serviceArea.createMany({
        data: [{ serviceId: s.id, areaId }],
        skipDuplicates: true,
      });
      grants += count;
    }
  }
  console.log(`  ${services.length} services -> ${areaIds.size} areas (${grants} grants added)`);

  for (const slug of RETIRED_AREA_SLUGS) {
    const area = await prisma.area.findFirst({ where: { slug, deletedAt: null } });
    if (!area) continue;
    const held = await prisma.zipCode.count({ where: { areaId: area.id, deletedAt: null } });
    if (held > 0) {
      console.error(`  ! "${slug}" still holds ${held} ZIP(s) -- left untouched`);
      continue;
    }
    if (!DRY_RUN) {
      // Join rows go first; the area itself is soft-deleted (onDelete: Restrict).
      await prisma.serviceArea.deleteMany({ where: { areaId: area.id } });
      await prisma.area.update({
        where: { id: area.id },
        data: { deletedAt: new Date(), status: GeoStatus.INACTIVE },
      });
    }
    console.log(`  retired "${slug}"`);
  }

  console.log(DRY_RUN ? "Dry run complete -- nothing written." : "Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
