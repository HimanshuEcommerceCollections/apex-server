import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/client";
import { ConfigStatus } from "../../enums";

const editInclude = {
  configGroups: { orderBy: { sortOrder: "asc" }, include: { options: { orderBy: { sortOrder: "asc" } } } },
  recurring: true,
} satisfies Prisma.ServiceInclude;

export type ServiceForEdit = Prisma.ServiceGetPayload<{ include: typeof editInclude }>;

export interface PricingUpdate {
  pricingMode?: "FROM" | "QUOTE";
  basePrice?: number;
  taxRateBps?: number;
  typicalDuration?: string | null;
  options?: { id: string; priceDelta: number }[];
}

/**
 * Runtime writer of the admin-controlled catalog: Service pricing fields,
 * configuration groups/options, per-service recurring rows, global cadences and
 * plans. The pricing engine reads these live, so a committed change is reflected
 * on the next recompute.
 */
export class CatalogRepository {
  findServiceForEdit(idOrSlug: string) {
    return prisma.service.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: editInclude,
    });
  }

  /** Apply a pricing update atomically. */
  async updatePricing(serviceId: string, changes: PricingUpdate): Promise<void> {
    await prisma.$transaction(async (tx) => {
      if (
        changes.pricingMode != null ||
        changes.basePrice != null ||
        changes.taxRateBps != null ||
        changes.typicalDuration !== undefined
      ) {
        await tx.service.update({
          where: { id: serviceId },
          data: {
            ...(changes.pricingMode != null ? { pricingMode: changes.pricingMode } : {}),
            ...(changes.basePrice != null ? { basePrice: changes.basePrice } : {}),
            ...(changes.taxRateBps != null ? { taxRateBps: changes.taxRateBps } : {}),
            ...(changes.typicalDuration !== undefined ? { typicalDuration: changes.typicalDuration || null } : {}),
          },
        });
      }
      for (const o of changes.options ?? []) {
        await tx.serviceConfigOption.update({ where: { id: o.id }, data: { priceDelta: o.priceDelta } });
      }
    });
  }

  // ── Configurations ─────────────────────────────────────────────────────────

  groupKeys(serviceId: string) {
    return prisma.serviceConfigGroup.findMany({ where: { serviceId }, select: { key: true } });
  }

  createGroup(data: Prisma.ServiceConfigGroupUncheckedCreateInput) {
    return prisma.serviceConfigGroup.create({ data, include: { options: true } });
  }

  findGroup(id: string) {
    return prisma.serviceConfigGroup.findUnique({ where: { id }, include: { options: true } });
  }

  updateGroup(id: string, data: Prisma.ServiceConfigGroupUncheckedUpdateInput) {
    return prisma.serviceConfigGroup.update({ where: { id }, data, include: { options: true } });
  }

  optionKeys(groupId: string) {
    return prisma.serviceConfigOption.findMany({ where: { groupId }, select: { key: true } });
  }

  async nextOptionSort(groupId: string): Promise<number> {
    const max = await prisma.serviceConfigOption.aggregate({ where: { groupId }, _max: { sortOrder: true } });
    return (max._max.sortOrder ?? -1) + 1;
  }

  async nextGroupSort(serviceId: string): Promise<number> {
    const max = await prisma.serviceConfigGroup.aggregate({ where: { serviceId }, _max: { sortOrder: true } });
    return (max._max.sortOrder ?? -1) + 1;
  }

  createOption(data: Prisma.ServiceConfigOptionUncheckedCreateInput) {
    return prisma.serviceConfigOption.create({ data });
  }

  findOption(id: string) {
    return prisma.serviceConfigOption.findUnique({ where: { id }, include: { group: true } });
  }

  updateOption(id: string, data: Prisma.ServiceConfigOptionUncheckedUpdateInput) {
    return prisma.serviceConfigOption.update({ where: { id }, data });
  }

  // ── Recurring (per-service grid) ───────────────────────────────────────────

  /** Upsert the sent rows (the grid is service × cadence, unique-constrained). */
  async putRecurring(
    serviceId: string,
    rows: { cadenceId: string; discountPercent: number; isActive: boolean }[],
  ): Promise<void> {
    await prisma.$transaction(
      rows.map((r) =>
        prisma.serviceRecurring.upsert({
          where: { serviceId_cadenceId: { serviceId, cadenceId: r.cadenceId } },
          create: { serviceId, cadenceId: r.cadenceId, discountPercent: r.discountPercent, isActive: r.isActive },
          update: { discountPercent: r.discountPercent, isActive: r.isActive },
        }),
      ),
    );
  }

  // ── Global cadences ────────────────────────────────────────────────────────

  listCadences() {
    return prisma.recurringCadence.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  }

  cadenceKeys() {
    return prisma.recurringCadence.findMany({ select: { key: true } });
  }

  async createCadence(data: Prisma.RecurringCadenceUncheckedCreateInput) {
    // A new cadence appears on every service's grid, inactive at 0% until an
    // admin turns it on per service.
    const cadence = await prisma.recurringCadence.create({ data });
    const services = await prisma.service.findMany({ select: { id: true } });
    if (services.length) {
      await prisma.serviceRecurring.createMany({
        data: services.map((s) => ({ serviceId: s.id, cadenceId: cadence.id })),
        skipDuplicates: true,
      });
    }
    return cadence;
  }

  findCadence(id: string) {
    return prisma.recurringCadence.findUnique({ where: { id } });
  }

  updateCadence(id: string, data: Prisma.RecurringCadenceUncheckedUpdateInput) {
    return prisma.recurringCadence.update({ where: { id }, data });
  }

  // ── Plans ──────────────────────────────────────────────────────────────────

  listPlans() {
    return prisma.servicePlan.findMany({
      orderBy: [{ createdAt: "desc" }],
      include: { service: { select: { name: true, slug: true } }, cadence: { select: { label: true } } },
    });
  }

  createPlan(data: Prisma.ServicePlanUncheckedCreateInput) {
    return prisma.servicePlan.create({
      data,
      include: { service: { select: { name: true, slug: true } }, cadence: { select: { label: true } } },
    });
  }

  findPlan(id: string) {
    return prisma.servicePlan.findUnique({ where: { id } });
  }

  updatePlan(id: string, data: Prisma.ServicePlanUncheckedUpdateInput) {
    return prisma.servicePlan.update({
      where: { id },
      data,
      include: { service: { select: { name: true, slug: true } }, cadence: { select: { label: true } } },
    });
  }

  /** Active cadences for grid assembly in the edit view. */
  activeCadences() {
    return prisma.recurringCadence.findMany({
      where: { status: ConfigStatus.ACTIVE },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  }
}

export const catalogRepository = new CatalogRepository();
