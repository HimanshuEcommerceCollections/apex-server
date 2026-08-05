import { prisma } from "../../db/client";
import { ConfigStatus } from "../../enums";

class PricingRepository {
  /** Service by id OR slug with everything pricing needs, in one query. */
  findServiceForPricing(idOrSlug: string) {
    return prisma.service.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: {
        configGroups: {
          where: { status: ConfigStatus.ACTIVE },
          orderBy: { sortOrder: "asc" },
          include: {
            options: {
              where: { status: ConfigStatus.ACTIVE },
              orderBy: { sortOrder: "asc" },
            },
          },
        },
      },
    });
  }
}

export const pricingRepository = new PricingRepository();
