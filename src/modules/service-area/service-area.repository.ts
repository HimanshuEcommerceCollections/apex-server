import { Prisma } from "@prisma/client";
import { prisma } from "../../db/client";
import type { CoverageEffect } from "../../enums";

/** Sole writer of ServiceArea + ServiceZipCoverage (one-model-one-writer). */
export class CoverageRepository {
  findServiceAreas(serviceId: string) {
    return prisma.serviceArea.findMany({ where: { serviceId } });
  }
  findZipCoverage(serviceId: string) {
    return prisma.serviceZipCoverage.findMany({ where: { serviceId } });
  }
  findServiceAreaGrant(serviceId: string, areaId: string) {
    return prisma.serviceArea.findUnique({ where: { serviceId_areaId: { serviceId, areaId } } });
  }
  findZipOverride(serviceId: string, zipCodeId: string) {
    return prisma.serviceZipCoverage.findUnique({
      where: { serviceId_zipCodeId: { serviceId, zipCodeId } },
    });
  }

  /** Atomically replace a service's entire coverage (grants + overrides). */
  async replaceCoverage(
    serviceId: string,
    areaIds: string[],
    overrides: { zipCodeId: string; effect: CoverageEffect }[],
  ): Promise<void> {
    const ops: Prisma.PrismaPromise<unknown>[] = [
      prisma.serviceArea.deleteMany({ where: { serviceId } }),
      prisma.serviceZipCoverage.deleteMany({ where: { serviceId } }),
    ];
    if (areaIds.length) {
      ops.push(
        prisma.serviceArea.createMany({
          data: areaIds.map((areaId) => ({ serviceId, areaId })),
          skipDuplicates: true,
        }),
      );
    }
    if (overrides.length) {
      ops.push(
        prisma.serviceZipCoverage.createMany({
          data: overrides.map((o) => ({ serviceId, zipCodeId: o.zipCodeId, effect: o.effect })),
          skipDuplicates: true,
        }),
      );
    }
    await prisma.$transaction(ops);
  }
}

export const coverageRepository = new CoverageRepository();
