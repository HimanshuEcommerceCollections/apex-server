import {
  PrismaClient,
  PricingMode,
  ConfigInputType,
  ConfigApplies,
  ConfigStatus,
  ServiceStatus,
  CategoryStatus,
  GeoStatus,
  Role,
  UserStatus,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import { AREAS, CATEGORIES, DEFAULT_COVERAGE, SERVICES, type SeedService } from "./seed-data";

const prisma = new PrismaClient();
const KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Pure pre-flight validation: fails loudly BEFORE any write (id-alignment, shapes). */
function validate(): void {
  const errors: string[] = [];
  for (const s of SERVICES) {
    const groupKeys = new Set<string>();
    for (const g of s.groups) {
      if (!KEY_RE.test(g.key)) errors.push(`${s.slug}: bad group key "${g.key}"`);
      if (groupKeys.has(g.key)) errors.push(`${s.slug}: duplicate group key "${g.key}"`);
      groupKeys.add(g.key);

      if (g.inputType === "TEXTAREA") {
        if (g.options?.length) errors.push(`${s.slug}/${g.key}: TEXTAREA must have no options`);
        if (s.mode !== "QUOTE") errors.push(`${s.slug}/${g.key}: TEXTAREA only allowed on QUOTE services`);
      } else if (g.inputType === "SELECT" || g.inputType === "MULTISELECT") {
        if (!g.options?.length) errors.push(`${s.slug}/${g.key}: ${g.inputType} needs options`);
        const optKeys = new Set<string>();
        for (const o of g.options ?? []) {
          if (!KEY_RE.test(o.key)) errors.push(`${s.slug}/${g.key}: bad option key "${o.key}"`);
          if (optKeys.has(o.key)) errors.push(`${s.slug}/${g.key}: duplicate option "${o.key}"`);
          optKeys.add(o.key);
          if (o.delta < 0) errors.push(`${s.slug}/${g.key}/${o.key}: negative delta`);
        }
      }
    }
    // rule triggers must resolve to real groups/options (id-alignment)
    for (const r of s.rules) {
      const g = s.groups.find((x) => x.key === r.trigger.group);
      if (!g) {
        errors.push(`${s.slug}: rule ${r.key} references unknown group "${r.trigger.group}"`);
        continue;
      }
      if (r.trigger.kind === "option_selected" && !g.options?.some((o) => o.key === r.trigger.option)) {
        errors.push(`${s.slug}: rule ${r.key} references unknown option "${r.trigger.option}"`);
      }
      if (r.effect.value < 0) errors.push(`${s.slug}: rule ${r.key} has a negative effect value`);
    }
  }
  if (errors.length) {
    throw new Error(`Seed validation failed:\n  - ${errors.join("\n  - ")}`);
  }
  console.log(`✓ validated ${SERVICES.length} services (id-alignment + shapes OK)`);
}

async function seedCategories(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const c of CATEGORIES) {
    const row = await prisma.serviceCategory.upsert({
      where: { slug: c.slug },
      create: { name: c.name, slug: c.slug, sortOrder: c.sortOrder, status: CategoryStatus.ACTIVE },
      update: { name: c.name, sortOrder: c.sortOrder },
    });
    map.set(c.slug, row.id);
  }
  return map;
}

async function seedService(s: SeedService, index: number, categoryId: string): Promise<string> {
  const service = await prisma.service.upsert({
    where: { slug: s.slug },
    create: {
      categoryId,
      name: s.name,
      slug: s.slug,
      summary: s.summary,
      description: s.description,
      pricingMode: s.mode as PricingMode,
      pricingRef: s.slug,
      basePrice: 0,
      fromPrice: s.fromPrice ?? null,
      currency: "USD",
      status: ServiceStatus.ACTIVE,
      badges: s.badges ?? [],
      sortOrder: index,
      claimsBlock: s.claimsBlock ?? null,
      isRecurringEligible: s.isRecurringEligible ?? false,
    },
    update: {
      categoryId,
      name: s.name,
      summary: s.summary,
      description: s.description,
      pricingMode: s.mode as PricingMode,
      pricingRef: s.slug,
      fromPrice: s.fromPrice ?? null,
      status: ServiceStatus.ACTIVE,
      badges: s.badges ?? [],
      sortOrder: index,
      claimsBlock: s.claimsBlock ?? null,
      isRecurringEligible: s.isRecurringEligible ?? false,
    },
  });

  // Resync config (delete-and-recreate — safe: bookings snapshot keys, not ids).
  await prisma.serviceConfigGroup.deleteMany({ where: { serviceId: service.id } });
  for (const [gi, g] of s.groups.entries()) {
    await prisma.serviceConfigGroup.create({
      data: {
        serviceId: service.id,
        key: g.key,
        label: g.label,
        inputType: g.inputType as ConfigInputType,
        uiHint: g.uiHint ?? null,
        applies: ConfigApplies.FLAT,
        isRequired: g.isRequired,
        sortOrder: gi,
        status: ConfigStatus.ACTIVE,
        selectMin: g.selectMin ?? null,
        selectMax: g.selectMax ?? null,
        options: {
          create: (g.options ?? []).map((o, oi) => ({
            key: o.key,
            label: o.label,
            sublabel: o.sublabel ?? null,
            priceDelta: o.delta,
            sortOrder: oi,
            status: ConfigStatus.ACTIVE,
          })),
        },
      },
    });
  }

  // Resync rules.
  await prisma.servicePricingRule.deleteMany({ where: { serviceId: service.id } });
  for (const [ri, r] of s.rules.entries()) {
    await prisma.servicePricingRule.create({
      data: {
        serviceId: service.id,
        key: r.key,
        label: r.label,
        trigger: r.trigger,
        effect: r.effect,
        sortOrder: r.sortOrder || ri,
        status: ConfigStatus.ACTIVE,
      },
    });
  }
  return service.id;
}

async function seedGeography(): Promise<Map<string, string>> {
  const areaIds = new Map<string, string>();
  for (const a of AREAS) {
    let area = await prisma.area.findFirst({ where: { slug: a.slug, deletedAt: null } });
    area = area
      ? await prisma.area.update({ where: { id: area.id }, data: { name: a.name, status: GeoStatus.ACTIVE } })
      : await prisma.area.create({ data: { name: a.name, slug: a.slug, duration: a.duration ?? null, status: GeoStatus.ACTIVE } });
    areaIds.set(a.slug, area.id);

    for (const z of a.zips) {
      const existing = await prisma.zipCode.findFirst({ where: { zipCode: z.zipCode, deletedAt: null } });
      if (existing) {
        await prisma.zipCode.update({
          where: { id: existing.id },
          data: { areaId: area.id, city: z.city, state: z.state, status: GeoStatus.ACTIVE },
        });
      } else {
        await prisma.zipCode.create({
          data: { areaId: area.id, zipCode: z.zipCode, city: z.city, state: z.state, status: GeoStatus.ACTIVE },
        });
      }
    }
  }
  return areaIds;
}

async function seedCoverage(serviceIds: Map<string, string>, areaIds: Map<string, string>): Promise<void> {
  for (const s of SERVICES) {
    const serviceId = serviceIds.get(s.slug)!;
    const areaSlugs = DEFAULT_COVERAGE[s.slug] ?? [...areaIds.keys()]; // default: cover every area
    for (const areaSlug of areaSlugs) {
      const areaId = areaIds.get(areaSlug);
      if (!areaId) continue;
      await prisma.serviceArea.upsert({
        where: { serviceId_areaId: { serviceId, areaId } },
        create: { serviceId, areaId },
        update: {},
      });
    }
  }
}

async function seedReferenceCounter(): Promise<void> {
  const year = new Date().getFullYear();
  await prisma.bookingReferenceCounter.upsert({
    where: { brandCode_year: { brandCode: "APX", year } },
    create: { brandCode: "APX", year, counter: 0 },
    update: {}, // never reset a live counter
  });
}

async function seedAdmin(): Promise<void> {
  const email = (process.env.ADMIN_EMAIL ?? "admin@apexhome.example").toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "ChangeMe123!";
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`✓ admin already exists: ${email}`);
    return;
  }
  await prisma.user.create({
    data: {
      email,
      name: "Apex Admin",
      role: Role.ADMIN,
      status: UserStatus.ACTIVE,
      passwordHash: bcrypt.hashSync(password, 10),
      emailVerifiedAt: new Date(),
    },
  });
  console.log(`✓ bootstrap admin created: ${email} / ${password}  (change this!)`);
}

async function main(): Promise<void> {
  validate();

  const categoryIds = await seedCategories();
  const serviceIds = new Map<string, string>();
  for (const [i, s] of SERVICES.entries()) {
    serviceIds.set(s.slug, await seedService(s, i, categoryIds.get(s.categorySlug)!));
  }
  console.log(`✓ seeded ${categoryIds.size} categories, ${serviceIds.size} services`);

  const areaIds = await seedGeography();
  const zipCount = AREAS.reduce((n, a) => n + a.zips.length, 0);
  console.log(`✓ seeded ${areaIds.size} area(s), ${zipCount} ZIP code(s)`);

  await seedCoverage(serviceIds, areaIds);
  await seedReferenceCounter();
  await seedAdmin();
  console.log("✓ coverage grants, reference counter, admin done");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
