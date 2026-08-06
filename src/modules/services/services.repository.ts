import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/client";
import { ConfigStatus, ServiceStatus } from "../../enums";

// Recurring rows feed the DERIVED "Recurring discount up to X%" label on every
// listing row (max active discountPercent).
const withCategory = {
  category: { select: { slug: true, name: true } },
  recurring: {
    where: { isActive: true, cadence: { status: ConfigStatus.ACTIVE } },
    select: { discountPercent: true },
  },
} satisfies Prisma.ServiceInclude;

// Detail pulls the full Recurring grid — the payment frequencies this service
// offers and the % each takes off the configured total. That grid is what the
// service page's "Recurring plans" cards AND its estimator's Frequency control
// are both built from.
//
// Plans are deliberately NOT included: a ServicePlan is a package of benefits,
// a separate concept that lives on /membership-plans. Service pages used to
// render Plans here, which conflated the two.
const withDetail = {
  category: { select: { slug: true, name: true } },
  recurring: {
    where: { isActive: true, cadence: { status: ConfigStatus.ACTIVE } },
    include: { cadence: true },
    orderBy: { cadence: { sortOrder: "asc" } },
  },
} satisfies Prisma.ServiceInclude;

export type ServiceWithCategory = Prisma.ServiceGetPayload<{ include: typeof withCategory }>;
export type ServiceWithDetail = Prisma.ServiceGetPayload<{ include: typeof withDetail }>;

export class ServicesRepository {
  findMany(args: { status?: ServiceStatus; categorySlug?: string }) {
    const where: Prisma.ServiceWhereInput = {};
    where.status = args.status ?? { in: [ServiceStatus.ACTIVE, ServiceStatus.COMING_SOON] };
    if (args.categorySlug) where.category = { slug: args.categorySlug };
    return prisma.service.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: withCategory,
    });
  }

  findByIdOrSlug(idOrSlug: string) {
    return prisma.service.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: withDetail,
    });
  }

  /** All service slugs (any status) — used to validate pro-application trades. */
  async allSlugs(): Promise<string[]> {
    const rows = await prisma.service.findMany({ select: { slug: true } });
    return rows.map((r) => r.slug);
  }
}

export const servicesRepository = new ServicesRepository();
