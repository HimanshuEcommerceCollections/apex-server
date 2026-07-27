import { quotesRepository, type QuoteWithRefs } from "./quotes.repository";
import { ApiError } from "../../utils/api-error";
import { buildMeta, buildPagination } from "../../utils/pagination";
import type { PaginationMeta } from "../../utils/api-response";
import type { QuoteView } from "./quotes.types";

interface ListQuery {
  status?: string;
  source?: string;
  search?: string;
  page?: number;
  limit?: number;
}

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
    return { quotes: rows.map((q) => this.serialize(q)), meta: buildMeta(page, limit, total) };
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

  private serialize(q: QuoteWithRefs): QuoteView {
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
      currency: q.currency,
      booking: q.booking ? { reference: q.booking.reference } : null,
      service: q.service ? { slug: q.service.slug, name: q.service.name } : null,
      createdAt: q.createdAt.toISOString(),
    };
  }
}

export const quotesService = new QuotesService();
