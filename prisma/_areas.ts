import { prisma } from "../src/db/client";
import { GeoStatus } from "../src/enums";
import { AREAS } from "./seed-data";
(async () => {
  const keep = new Set(AREAS.map((a) => a.slug));
  const areaIds = new Map<string, string>();
  for (const a of AREAS) {
    let area = await prisma.area.findFirst({ where: { slug: a.slug, deletedAt: null } });
    area = area
      ? await prisma.area.update({ where: { id: area.id }, data: { name: a.name, duration: a.duration ?? null, status: GeoStatus.ACTIVE } })
      : await prisma.area.create({ data: { name: a.name, slug: a.slug, duration: a.duration ?? null, status: GeoStatus.ACTIVE } });
    areaIds.set(a.slug, area.id);
    for (const z of a.zips) {
      const ex = await prisma.zipCode.findFirst({ where: { zipCode: z.zipCode, deletedAt: null } });
      if (ex) await prisma.zipCode.update({ where: { id: ex.id }, data: { areaId: area.id, city: z.city, state: z.state, status: GeoStatus.ACTIVE } });
      else await prisma.zipCode.create({ data: { areaId: area.id, zipCode: z.zipCode, city: z.city, state: z.state, status: GeoStatus.ACTIVE } });
    }
  }
  // grant every active service coverage in every new area (so booking ZIP resolution still works)
  const services = await prisma.service.findMany({ where: { status: { notIn: ["DRAFT", "INACTIVE"] } }, select: { id: true } });
  for (const s of services) for (const areaId of areaIds.values())
    await prisma.serviceArea.upsert({ where: { serviceId_areaId: { serviceId: s.id, areaId } }, create: { serviceId: s.id, areaId }, update: {} });
  // retire any area no longer in the seed (the old wake-county) + its leftover ZIPs
  const stale = await prisma.area.findMany({ where: { slug: { notIn: [...keep] }, deletedAt: null } });
  for (const a of stale) {
    await prisma.zipCode.updateMany({ where: { areaId: a.id, deletedAt: null }, data: { status: GeoStatus.INACTIVE, deletedAt: new Date() } });
    await prisma.area.update({ where: { id: a.id }, data: { status: GeoStatus.INACTIVE, deletedAt: new Date() } });
  }
  const active = await prisma.area.findMany({ where: { status: "ACTIVE", deletedAt: null }, select: { name: true, duration: true }, orderBy: { name: "asc" } });
  console.log("active areas:", active.map((a) => `${a.name}(${a.duration})`).join(", "));
  console.log("retired:", stale.map((a) => a.name).join(", ") || "none");
  await prisma.$disconnect(); process.exit(0);
})().catch((e) => { console.error("FAIL", String(e).slice(0, 300)); process.exit(1); });
