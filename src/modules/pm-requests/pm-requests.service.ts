import type { z } from "zod";
import { PMBundle, FormKind } from "../../enums";
import { pmRequestsRepository, type PmRequestWithQuote } from "./pm-requests.repository";
import { quotesService } from "../quotes";
import { demoInboxService } from "../demo-inbox";
import { ApiError } from "../../utils/api-error";
import { buildMeta, buildPagination } from "../../utils/pagination";
import type { PaginationMeta } from "../../utils/api-response";
import type { createPmRequestSchema } from "./pm-requests.validation";
import type { PmRequestView } from "./pm-requests.types";

export type CreatePmRequestDto = z.infer<typeof createPmRequestSchema>;

interface ListQuery {
  status?: string;
  bundle?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export class PmRequestsService {
  async submit(dto: CreatePmRequestDto): Promise<{ pm_request_id: string; quote_request_id: string }> {
    const pm = await pmRequestsRepository.createWithQuote({
      company: dto.company ?? null,
      unitsEst: dto.units_est,
      bundle: dto.bundle as PMBundle,
      scopeNotes: dto.scope_notes,
      contactName: dto.contact.name,
      contactEmail: dto.contact.email,
      contactPhone: dto.contact.phone ?? null,
    });
    await demoInboxService.record(FormKind.PM_REQUEST, pm.id, dto);
    return { pm_request_id: pm.id, quote_request_id: pm.quoteRequest.id };
  }

  /** Coordinator screening queue. */
  async list(query: ListQuery): Promise<{ requests: PmRequestView[]; meta: PaginationMeta }> {
    const { page, limit, skip } = buildPagination(query);
    const { rows, total } = await pmRequestsRepository.listAndCount({
      status: query.status,
      bundle: query.bundle,
      search: query.search,
      skip,
      take: limit,
    });
    return { requests: rows.map((r) => this.serialize(r)), meta: buildMeta(page, limit, total) };
  }

  async getOrThrow(id: string): Promise<PmRequestView> {
    const row = await pmRequestsRepository.findById(id);
    if (!row) throw ApiError.notFound("Property manager request not found", { code: "PM_REQUEST_NOT_FOUND" });
    return this.serialize(row);
  }

  /**
   * Triage a request. `status` / `quotedAmount` live on the parent QuoteRequest,
   * so the write delegates to quotesService.setQuote — the audited path that
   * stamps quotedByUserId + quotedAt. This screen never writes them directly, so
   * a price set here is indistinguishable from one set on the Quotes screen.
   */
  async triage(
    id: string,
    changes: { quotedAmount?: number; status?: string },
    actorUserId: string,
  ): Promise<PmRequestView> {
    const row = await pmRequestsRepository.findById(id);
    if (!row) throw ApiError.notFound("Property manager request not found", { code: "PM_REQUEST_NOT_FOUND" });
    await quotesService.setQuote(row.quoteRequestId, changes, actorUserId);
    return this.getOrThrow(id);
  }

  private serialize(r: PmRequestWithQuote): PmRequestView {
    return {
      id: r.id,
      quoteRequestId: r.quoteRequestId,
      company: r.company,
      unitsEst: r.unitsEst,
      bundle: r.bundle,
      scopeNotes: r.scopeNotes,
      status: r.quoteRequest.status,
      contactName: r.quoteRequest.contactName,
      contactEmail: r.quoteRequest.contactEmail,
      contactPhone: r.quoteRequest.contactPhone,
      quotedAmount: r.quoteRequest.quotedAmount,
      quotedAt: r.quoteRequest.quotedAt ? r.quoteRequest.quotedAt.toISOString() : null,
      currency: r.quoteRequest.currency,
      createdAt: r.createdAt.toISOString(),
    };
  }
}

export const pmRequestsService = new PmRequestsService();
