import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/client";

const editInclude = {
  configGroups: { orderBy: { sortOrder: "asc" }, include: { options: { orderBy: { sortOrder: "asc" } } } },
  pricingRules: { orderBy: { sortOrder: "asc" } },
} satisfies Prisma.ServiceInclude;

export type ServiceForEdit = Prisma.ServiceGetPayload<{ include: typeof editInclude }>;

export interface PricingUpdate {
  basePrice?: number;
  fromPrice?: number | null;
  typicalDuration?: string | null;
  recurringDiscount?: string | null;
  options?: { id: string; priceDelta: number }[];
  rules?: { id: string; value: number }[];
}

export interface RecurringPlanInput {
  name: string;
  freq: string;
  amount: string;
  unit?: string | null;
  disc?: string | null;
  best?: boolean;
  cta: string;
}

const recurringRef = {
  id: true,
  slug: true,
  name: true,
  recurringHeading: true,
  recurringPlans: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
} satisfies Prisma.ServiceSelect;

export type ServiceRecurringRef = Prisma.ServiceGetPayload<{ select: typeof recurringRef }>;

/**
 * Runtime writer of catalog PRICING fields (Service.basePrice/fromPrice,
 * ServiceConfigOption.priceDelta, ServicePricingRule.effect.value). Reads ALL
 * rows (any status) for the admin editor. The pricing engine reads these live,
 * so a committed change is reflected on the next recompute (docs 07 §7).
 */
export class CatalogRepository {
  findServiceForEdit(idOrSlug: string) {
    return prisma.service.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: editInclude,
    });
  }

  /** Service + its recurring-plan cards (all rows, any status) for the admin editor. */
  findServiceRecurring(idOrSlug: string): Promise<ServiceRecurringRef | null> {
    return prisma.service.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      select: recurringRef,
    });
  }

  /** Replace a service's recurring section (heading + full ordered plan list) atomically. */
  async replaceRecurring(serviceId: string, heading: string | null, plans: RecurringPlanInput[]): Promise<void> {
    await prisma.$transaction([
      prisma.service.update({ where: { id: serviceId }, data: { recurringHeading: heading } }),
      prisma.serviceRecurringPlan.deleteMany({ where: { serviceId } }),
      prisma.serviceRecurringPlan.createMany({
        data: plans.map((p, i) => ({
          serviceId,
          name: p.name,
          freq: p.freq,
          amount: p.amount,
          unit: p.unit ?? null,
          disc: p.disc ?? null,
          best: p.best ?? false,
          cta: p.cta,
          sortOrder: i,
          active: true,
        })),
      }),
    ]);
  }

  /** Apply a pricing update atomically. `ruleEffects` carries the pre-read effect JSONs. */
  async updatePricing(
    serviceId: string,
    changes: PricingUpdate,
    ruleEffects: Map<string, Record<string, unknown>>,
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      if (
        changes.basePrice != null ||
        changes.fromPrice !== undefined ||
        changes.typicalDuration !== undefined ||
        changes.recurringDiscount !== undefined
      ) {
        await tx.service.update({
          where: { id: serviceId },
          data: {
            ...(changes.basePrice != null ? { basePrice: changes.basePrice } : {}),
            ...(changes.fromPrice !== undefined ? { fromPrice: changes.fromPrice } : {}),
            ...(changes.typicalDuration !== undefined ? { typicalDuration: changes.typicalDuration || null } : {}),
            ...(changes.recurringDiscount !== undefined ? { recurringDiscount: changes.recurringDiscount || null } : {}),
          },
        });
      }
      for (const o of changes.options ?? []) {
        await tx.serviceConfigOption.update({ where: { id: o.id }, data: { priceDelta: o.priceDelta } });
      }
      for (const r of changes.rules ?? []) {
        const effect = ruleEffects.get(r.id);
        if (!effect) continue;
        await tx.servicePricingRule.update({
          where: { id: r.id },
          data: { effect: { ...effect, value: r.value } as Prisma.InputJsonValue },
        });
      }
    });
  }
}

export const catalogRepository = new CatalogRepository();
