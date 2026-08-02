import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/client";

export interface ProApplicationListFilter {
  status?: string;
  trade?: string; // service slug; matches applications offering that trade
  search?: string;
  skip: number;
  take: number;
}

/** Sole writer of ProApplication. */
export class ProApplicationsRepository {
  create(data: Prisma.ProApplicationUncheckedCreateInput) {
    return prisma.proApplication.create({ data });
  }

  /** Screening queue: newest first. Filters AND together. */
  async listAndCount(f: ProApplicationListFilter) {
    const where: Prisma.ProApplicationWhereInput = {};
    if (f.status) where.status = f.status as never;
    if (f.trade) where.trades = { has: f.trade };
    if (f.search) {
      where.OR = [
        { name: { contains: f.search, mode: "insensitive" } },
        { email: { contains: f.search, mode: "insensitive" } },
        { company: { contains: f.search, mode: "insensitive" } },
        { zip: { contains: f.search } },
      ];
    }
    const [rows, total] = await Promise.all([
      prisma.proApplication.findMany({ where, orderBy: { createdAt: "desc" }, skip: f.skip, take: f.take }),
      prisma.proApplication.count({ where }),
    ]);
    return { rows, total };
  }

  findById(id: string) {
    return prisma.proApplication.findUnique({ where: { id } });
  }

  update(id: string, data: Prisma.ProApplicationUncheckedUpdateInput) {
    return prisma.proApplication.update({ where: { id }, data });
  }
}

export const proApplicationsRepository = new ProApplicationsRepository();
