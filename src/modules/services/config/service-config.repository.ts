import type { Prisma } from "@prisma/client";
import { prisma } from "../../../db/client";
import { ConfigStatus } from "../../../enums";

const configInclude = {
  configGroups: {
    where: { status: ConfigStatus.ACTIVE },
    orderBy: { sortOrder: "asc" },
    include: {
      options: { where: { status: ConfigStatus.ACTIVE }, orderBy: { sortOrder: "asc" } },
    },
  },
  // The /book frequency section: active cadence offers with their discount %.
  recurring: {
    where: { isActive: true, cadence: { status: ConfigStatus.ACTIVE } },
    include: { cadence: true },
  },
} satisfies Prisma.ServiceInclude;

export type ServiceWithConfig = Prisma.ServiceGetPayload<{ include: typeof configInclude }>;

export class ServiceConfigRepository {
  findServiceWithConfig(idOrSlug: string) {
    return prisma.service.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: configInclude,
    });
  }
}

export const serviceConfigRepository = new ServiceConfigRepository();
