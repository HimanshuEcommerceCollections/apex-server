import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/client";

/** Sole writer of ProApplication. */
export class ProApplicationsRepository {
  create(data: Prisma.ProApplicationUncheckedCreateInput) {
    return prisma.proApplication.create({ data });
  }
}

export const proApplicationsRepository = new ProApplicationsRepository();
