import type { Area } from "@prisma/client";
import { areasRepository } from "./areas.repository";
import { ApiError } from "../../utils/api-error";
import { buildMeta, buildPagination } from "../../utils/pagination";
import { slugify } from "../../utils/slugify";
import { GeoStatus } from "../../enums";
import type { PaginationMeta } from "../../utils/api-response";
import type { AreaView } from "./areas.types";

interface ListQuery {
  search?: string;
  status?: "ACTIVE" | "INACTIVE";
  includeDeleted?: boolean;
  page?: number;
  limit?: number;
}

export class AreasService {
  async list(query: ListQuery): Promise<{ areas: AreaView[]; meta: PaginationMeta }> {
    const { page, limit, skip } = buildPagination(query);
    const { rows, total } = await areasRepository.listAndCount({
      search: query.search,
      status: query.status,
      includeDeleted: query.includeDeleted,
      skip,
      take: limit,
    });
    return { areas: rows.map((a) => this.serialize(a)), meta: buildMeta(page, limit, total) };
  }

  async getOrThrow(id: string): Promise<Area> {
    const area = await areasRepository.findById(id);
    if (!area || area.deletedAt) throw ApiError.notFound("Area not found", { code: "AREA_NOT_FOUND" });
    return area;
  }

  async create(name: string, duration?: string | null): Promise<AreaView> {
    if (await areasRepository.findActiveByName(name)) {
      throw ApiError.conflict("An area with this name already exists", { code: "AREA_NAME_TAKEN" });
    }
    const area = await areasRepository.create({ name, slug: slugify(name), duration: duration || null });
    return this.serialize(area);
  }

  async update(
    id: string,
    changes: { name?: string; status?: "ACTIVE" | "INACTIVE"; duration?: string | null },
  ): Promise<AreaView> {
    const area = await this.getOrThrow(id);
    const data: { name?: string; slug?: string; status?: GeoStatus; duration?: string | null } = {};
    if (changes.name && changes.name !== area.name) {
      if (await areasRepository.findActiveByName(changes.name, id)) {
        throw ApiError.conflict("An area with this name already exists", { code: "AREA_NAME_TAKEN" });
      }
      data.name = changes.name;
      data.slug = slugify(changes.name);
    }
    if (changes.status) data.status = changes.status as GeoStatus;
    // `undefined` = leave unchanged; "" or null = clear the label.
    if (changes.duration !== undefined) data.duration = changes.duration || null;
    const updated = await areasRepository.update(id, data);
    return this.serialize(updated);
  }

  async softDelete(id: string): Promise<void> {
    await this.getOrThrow(id);
    await areasRepository.update(id, { deletedAt: new Date(), status: GeoStatus.INACTIVE });
  }

  async restore(id: string): Promise<AreaView> {
    const area = await areasRepository.findById(id);
    if (!area) throw ApiError.notFound("Area not found", { code: "AREA_NOT_FOUND" });
    if (!area.deletedAt) return this.serialize(area);
    if (await areasRepository.findActiveByName(area.name, id)) {
      throw ApiError.conflict("Another active area now uses this name", { code: "AREA_NAME_TAKEN" });
    }
    const updated = await areasRepository.update(id, { deletedAt: null, status: GeoStatus.ACTIVE });
    return this.serialize(updated);
  }

  /** Public: active areas with their active ZIPs. */
  async listPublic(): Promise<
    {
      id: string;
      name: string;
      slug: string;
      duration: string | null;
      zipCodes: { zipCode: string; city: string | null; state: string | null }[];
    }[]
  > {
    const rows = await areasRepository.listActiveWithZips();
    return rows.map((a) => ({
      id: a.id,
      name: a.name,
      slug: a.slug,
      duration: a.duration,
      zipCodes: a.zipCodes.map((z) => ({ zipCode: z.zipCode, city: z.city, state: z.state })),
    }));
  }

  private serialize(a: Area): AreaView {
    return {
      id: a.id,
      name: a.name,
      slug: a.slug,
      duration: a.duration,
      status: a.status,
      deletedAt: a.deletedAt ? a.deletedAt.toISOString() : null,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    };
  }
}

export const areasService = new AreasService();
