import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/client";
import { GeoStatus } from "../../enums";

const withArea = { area: { select: { id: true, name: true, slug: true } } } as const;
export type ZipWithArea = Prisma.ZipCodeGetPayload<{ include: typeof withArea }>;

export interface ZipListFilter {
  areaId?: string;
  search?: string;
  status?: "ACTIVE" | "INACTIVE";
  includeDeleted?: boolean;
  skip: number;
  take: number;
}

export class ZipCodesRepository {
  private baseWhere(f: Omit<ZipListFilter, "skip" | "take">): Prisma.ZipCodeWhereInput {
    const where: Prisma.ZipCodeWhereInput = {};
    if (!f.includeDeleted) where.deletedAt = null;
    if (f.areaId) where.areaId = f.areaId;
    if (f.status) where.status = f.status;
    if (f.search) {
      where.OR = [
        { zipCode: { contains: f.search } },
        { city: { contains: f.search, mode: "insensitive" } },
      ];
    }
    return where;
  }

  async listAndCount(f: ZipListFilter) {
    const where = this.baseWhere(f);
    const [rows, total] = await Promise.all([
      prisma.zipCode.findMany({ where, orderBy: { zipCode: "asc" }, skip: f.skip, take: f.take, include: withArea }),
      prisma.zipCode.count({ where }),
    ]);
    return { rows, total };
  }

  findById(id: string) {
    return prisma.zipCode.findUnique({ where: { id }, include: withArea });
  }

  /** Duplicate guard: one active ZIP globally (deterministic zip -> area). */
  findActiveByCode(code: string, exceptId?: string) {
    return prisma.zipCode.findFirst({
      where: { zipCode: code, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
  }

  /** Resolution read: an active ZIP inside an active area, joined to its area. */
  findServiceableByCode(code: string) {
    return prisma.zipCode.findFirst({
      where: {
        zipCode: code,
        deletedAt: null,
        status: GeoStatus.ACTIVE,
        area: { status: GeoStatus.ACTIVE, deletedAt: null },
      },
      include: { area: true },
    });
  }

  create(data: Prisma.ZipCodeUncheckedCreateInput) {
    return prisma.zipCode.create({ data, include: withArea });
  }
  update(id: string, data: Prisma.ZipCodeUncheckedUpdateInput) {
    return prisma.zipCode.update({ where: { id }, data, include: withArea });
  }
}

export const zipCodesRepository = new ZipCodesRepository();
