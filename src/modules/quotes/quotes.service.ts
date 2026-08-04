import { quotesRepository, type QuoteWithRefs } from "./quotes.repository";
import { ApiError } from "../../utils/api-error";
import { buildMeta, buildPagination } from "../../utils/pagination";
import type { PaginationMeta } from "../../utils/api-response";
import { pricingService } from "../pricing";
import type { QuoteView } from "./quotes.types";

interface ListQuery {
  status?: string;
  source?: string;
  search?: string;
  page?: number;
  limit?: number;
}

type EngineSelections = Record<string, string | number | boolean | string[]>;

export class QuotesService {
  async list(query: ListQuery): Promise<{ quotes: QuoteView[]; meta: PaginationMeta }> {
    const { page, limit, skip } = buildPagination(query);
    const { rows, total } = await quotesRepository.listAndCount({
      status: query.status,
      source: query.source,
      search: query.search,
      skip,
      take: limit,
    });
    const quotes = await Promise.all(rows.map((q) => this.serialize(q)));
    return { quotes, meta: buildMeta(page, limit, total) };
  }

  /** Coordinator sets the final price and/or advances the quote's status (audited via quotedByUserId). */
  async setQuote(
    id: string,
    changes: { quotedAmount?: number; status?: string },
    actorUserId: string,
  ): Promise<QuoteView> {
    const existing = await quotesRepository.findById(id);
    if (!existing) throw ApiError.notFound("Quote not found", { code: "QUOTE_NOT_FOUND" });

    const row = await quotesRepository.update(id, {
      ...(changes.quotedAmount != null
        ? { quotedAmount: changes.quotedAmount, quotedByUserId: actorUserId, quotedAt: new Date() }
        : {}),
      ...(changes.status ? { status: changes.status as never } : {}),
    });
    return this.serialize(row);
  }

  private async serialize(q: QuoteWithRefs): Promise<QuoteView> {
    // Indicative engine total for the stored configuration — a starting point for
    // the coordinator's number, never binding (pricingService.indicativeFor is
    // best-effort and resolves null rather than failing the listing).
    const cfg = q.booking?.configuration;
    const indicative =
      cfg && q.service
        ? await pricingService.indicativeFor(
            q.service.slug,
            (cfg.selections ?? {}) as EngineSelections,
            cfg.quantity,
          )
        : null;

    return {
      id: q.id,
      status: q.status,
      source: q.source,
      description: q.description,
      contactName: q.contactName,
      contactEmail: q.contactEmail,
      contactPhone: q.contactPhone,
      quotedAmount: q.quotedAmount,
      quotedAt: q.quotedAt ? q.quotedAt.toISOString() : null,
      indicativeAmount: indicative?.total.amount ?? null,
      currency: q.currency,
      booking: q.booking ? { reference: q.booking.reference } : null,
      service: q.service ? { slug: q.service.slug, name: q.service.name } : null,
      createdAt: q.createdAt.toISOString(),
    };
  }
}

export const quotesService = new QuotesService();
