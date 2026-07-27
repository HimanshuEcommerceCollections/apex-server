import { zipCodesRepository, type ZipWithArea } from "./zip-codes.repository";
import { areasService } from "../areas";
import { ApiError } from "../../utils/api-error";
import { buildMeta, buildPagination } from "../../utils/pagination";
import { GeoStatus } from "../../enums";
import type { PaginationMeta } from "../../utils/api-response";
import type { ZipCodeView } from "./zip-codes.types";

interface ListQuery {
  areaId?: string;
  search?: string;
  status?: "ACTIVE" | "INACTIVE";
  includeDeleted?: boolean;
  page?: number;
  limit?: number;
}

interface CreateDto {
  areaId: string;
  zipCode: string;
  city?: string;
  state?: string;
}
interface UpdateDto {
  areaId?: string;
  zipCode?: string;
  city?: string | null;
  state?: string | null;
  status?: "ACTIVE" | "INACTIVE";
}

export class ZipCodesService {
  async list(query: ListQuery): Promise<{ zipCodes: ZipCodeView[]; meta: PaginationMeta }> {
    const { page, limit, skip } = buildPagination(query);
    const { rows, total } = await zipCodesRepository.listAndCount({
      areaId: query.areaId,
      search: query.search,
      status: query.status,
      includeDeleted: query.includeDeleted,
      skip,
      take: limit,
    });
    return { zipCodes: rows.map((z) => this.serialize(z)), meta: buildMeta(page, limit, total) };
  }

  async create(dto: CreateDto): Promise<ZipCodeView> {
    await areasService.getOrThrow(dto.areaId); // area must exist and be non-deleted
    if (await zipCodesRepository.findActiveByCode(dto.zipCode)) {
      throw ApiError.conflict("This ZIP code already exists", { code: "ZIP_TAKEN" });
    }
    const row = await zipCodesRepository.create({
      areaId: dto.areaId,
      zipCode: dto.zipCode,
      city: dto.city ?? null,
      state: dto.state ?? null,
    });
    return this.serialize(row);
  }

  async update(id: string, changes: UpdateDto): Promise<ZipCodeView> {
    const existing = await zipCodesRepository.findById(id);
    if (!existing || existing.deletedAt) {
      throw ApiError.notFound("ZIP code not found", { code: "ZIP_NOT_FOUND" });
    }
    if (changes.areaId && changes.areaId !== existing.areaId) {
      await areasService.getOrThrow(changes.areaId);
    }
    if (changes.zipCode && changes.zipCode !== existing.zipCode) {
      if (await zipCodesRepository.findActiveByCode(changes.zipCode, id)) {
        throw ApiError.conflict("This ZIP code already exists", { code: "ZIP_TAKEN" });
      }
    }
    const row = await zipCodesRepository.update(id, {
      ...(changes.areaId !== undefined ? { areaId: changes.areaId } : {}),
      ...(changes.zipCode !== undefined ? { zipCode: changes.zipCode } : {}),
      ...(changes.city !== undefined ? { city: changes.city } : {}),
      ...(changes.state !== undefined ? { state: changes.state } : {}),
      ...(changes.status !== undefined ? { status: changes.status as GeoStatus } : {}),
    });
    return this.serialize(row);
  }

  async softDelete(id: string): Promise<void> {
    const existing = await zipCodesRepository.findById(id);
    if (!existing || existing.deletedAt) {
      throw ApiError.notFound("ZIP code not found", { code: "ZIP_NOT_FOUND" });
    }
    await zipCodesRepository.update(id, { deletedAt: new Date(), status: GeoStatus.INACTIVE });
  }

  /** Resolution helper for the availability service (active ZIP in an active area). */
  findServiceableByCode(code: string) {
    return zipCodesRepository.findServiceableByCode(code);
  }

  private serialize(z: ZipWithArea): ZipCodeView {
    return {
      id: z.id,
      areaId: z.areaId,
      area: z.area ? { id: z.area.id, name: z.area.name, slug: z.area.slug } : null,
      zipCode: z.zipCode,
      city: z.city,
      state: z.state,
      status: z.status,
      deletedAt: z.deletedAt ? z.deletedAt.toISOString() : null,
      createdAt: z.createdAt.toISOString(),
      updatedAt: z.updatedAt.toISOString(),
    };
  }
}

export const zipCodesService = new ZipCodesService();
