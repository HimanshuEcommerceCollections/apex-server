import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/client";

export interface AreaListFilter {
  search?: string;
  status?: "ACTIVE" | "INACTIVE";
  includeDeleted?: boolean;
  skip: number;
  take: number;
}

export class AreasRepository {
  private baseWhere(f: Pick<AreaListFilter, "search" | "status" | "includeDeleted">): Prisma.AreaWhereInput {
    const where: Prisma.AreaWhereInput = {};
    if (!f.includeDeleted) where.deletedAt = null;
    if (f.status) where.status = f.status;
    if (f.search) where.name = { contains: f.search, mode: "insensitive" };
    return where;
  }

  async listAndCount(f: AreaListFilter) {
    const where = this.baseWhere(f);
    const [rows, total] = await Promise.all([
      prisma.area.findMany({ where, orderBy: { name: "asc" }, skip: f.skip, take: f.take }),
      prisma.area.count({ where }),
    ]);
    return { rows, total };
  }

  findById(id: string) {
    return prisma.area.findUnique({ where: { id } });
  }

  /** Duplicate-name guard among non-deleted areas (case-insensitive). */
  findActiveByName(name: string, exceptId?: string) {
    return prisma.area.findFirst({
      where: {
        deletedAt: null,
        name: { equals: name, mode: "insensitive" },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
  }

  /** Public read: active areas with their active ZIPs (the /service-area page). */
  listActiveWithZips() {
    return prisma.area.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      orderBy: { name: "asc" },
      include: {
        zipCodes: {
          where: { status: "ACTIVE", deletedAt: null },
          orderBy: { zipCode: "asc" },
          select: { zipCode: true, city: true, state: true },
        },
      },
    });
  }

  create(data: Prisma.AreaUncheckedCreateInput) {
    return prisma.area.create({ data });
  }
  update(id: string, data: Prisma.AreaUncheckedUpdateInput) {
    return prisma.area.update({ where: { id }, data });
  }
}

export const areasRepository = new AreasRepository();
