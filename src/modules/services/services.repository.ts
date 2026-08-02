import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/client";
import { ServiceStatus } from "../../enums";

const withCategory = { category: { select: { slug: true, name: true } } } as const;

// Detail also pulls the active "Recurring plans" cards (ordered) for the service page.
const withDetail = {
  category: { select: { slug: true, name: true } },
  recurringPlans: {
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
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
