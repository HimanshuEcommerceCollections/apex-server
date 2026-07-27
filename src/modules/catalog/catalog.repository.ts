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
  options?: { id: string; priceDelta: number }[];
  rules?: { id: string; value: number }[];
}

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

  /** Apply a pricing update atomically. `ruleEffects` carries the pre-read effect JSONs. */
  async updatePricing(
    serviceId: string,
    changes: PricingUpdate,
    ruleEffects: Map<string, Record<string, unknown>>,
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      if (changes.basePrice != null || changes.fromPrice !== undefined) {
        await tx.service.update({
          where: { id: serviceId },
          data: {
            ...(changes.basePrice != null ? { basePrice: changes.basePrice } : {}),
            ...(changes.fromPrice !== undefined ? { fromPrice: changes.fromPrice } : {}),
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
