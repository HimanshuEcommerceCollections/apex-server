import { prisma } from "../../db/client";
import { ConfigStatus } from "../../enums";
import { ONE_TIME_CADENCE_KEY } from "../../constants";

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
        // The Recurring grid: which payment frequencies this service offers and
        // the % each takes off the configured pre-tax total.
        recurring: {
          where: { isActive: true, cadence: { status: ConfigStatus.ACTIVE } },
          include: { cadence: true },
          orderBy: { cadence: { sortOrder: "asc" } },
        },
      },
    });
  }

  /** The system one-time cadence — the default every booking falls back to. */
  findOneTimeCadence() {
    return prisma.recurringCadence.findUnique({ where: { key: ONE_TIME_CADENCE_KEY } });
  }
}

export const pricingRepository = new PricingRepository();
