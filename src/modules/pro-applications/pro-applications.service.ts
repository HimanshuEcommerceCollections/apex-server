import type { z } from "zod";
import type { Prisma, ProApplication } from "@prisma/client";
import { FormKind, type ProApplicationStatus } from "../../enums";
import { ApiError } from "../../utils/api-error";
import { proApplicationsRepository } from "./pro-applications.repository";
import { servicesRepository } from "../services";
import { demoInboxService } from "../demo-inbox";
import { buildMeta, buildPagination } from "../../utils/pagination";
import type { PaginationMeta } from "../../utils/api-response";
import type { createProApplicationSchema } from "./pro-applications.validation";
import type { ProApplicationView } from "./pro-applications.types";

export type CreateProApplicationDto = z.infer<typeof createProApplicationSchema>;

interface ListQuery {
  status?: string;
  trade?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export class ProApplicationsService {
  async submit(dto: CreateProApplicationDto): Promise<{ application_id: string }> {
    // Trades must be known service slugs (validated at the business layer, not FK'd).
    const known = new Set(await servicesRepository.allSlugs());
    const unknown = dto.trades.filter((t) => !known.has(t));
    if (unknown.length) {
      throw ApiError.unprocessable("Unknown trade(s)", { code: "UNKNOWN_TRADE", trades: unknown });
    }

    const row = await proApplicationsRepository.create({
      name: dto.name,
      email: dto.email,
      phone: dto.phone ?? null,
      zip: dto.zip,
      trades: dto.trades,
      acknowledgements: dto.acknowledgements as Prisma.InputJsonValue,
      experience: dto.experience ?? null,
      company: dto.company ?? null,
      availability: dto.availability ?? null,
      preferredStart: dto.preferred_start ?? null,
      intro: dto.intro ?? null,
    });
    await demoInboxService.record(FormKind.PRO_APPLICATION, row.id, dto);
    return { application_id: row.id };
  }

  /** Coordinator screening queue. */
  async list(query: ListQuery): Promise<{ applications: ProApplicationView[]; meta: PaginationMeta }> {
    const { page, limit, skip } = buildPagination(query);
    const { rows, total } = await proApplicationsRepository.listAndCount({
      status: query.status,
      trade: query.trade,
      search: query.search,
      skip,
      take: limit,
    });
    return { applications: rows.map((r) => this.serialize(r)), meta: buildMeta(page, limit, total) };
  }

  async getOrThrow(id: string): Promise<ProApplicationView> {
    const row = await proApplicationsRepository.findById(id);
    if (!row) throw ApiError.notFound("Application not found", { code: "PRO_APPLICATION_NOT_FOUND" });
    return this.serialize(row);
  }

  /** Advance the application through screening and/or record coordinator notes. */
  async screen(
    id: string,
    changes: { status?: string; notes?: string | null },
  ): Promise<ProApplicationView> {
    const existing = await proApplicationsRepository.findById(id);
    if (!existing) throw ApiError.notFound("Application not found", { code: "PRO_APPLICATION_NOT_FOUND" });
    const row = await proApplicationsRepository.update(id, {
      ...(changes.status ? { status: changes.status as ProApplicationStatus } : {}),
      // `undefined` = leave unchanged; "" or null = clear the note.
      ...(changes.notes !== undefined ? { notes: changes.notes || null } : {}),
    });
    return this.serialize(row);
  }

  private serialize(r: ProApplication): ProApplicationView {
    return {
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      zip: r.zip,
      trades: r.trades,
      acknowledgements: (r.acknowledgements ?? {}) as Record<string, Record<string, boolean>>,
      experience: r.experience,
      company: r.company,
      availability: r.availability,
      preferredStart: r.preferredStart,
      intro: r.intro,
      status: r.status,
      notes: r.notes,
      promotedUserId: r.promotedUserId,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}

export const proApplicationsService = new ProApplicationsService();
