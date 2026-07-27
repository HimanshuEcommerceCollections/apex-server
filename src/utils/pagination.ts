import type { PaginationMeta } from "./api-response";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface Pagination {
  page: number;
  limit: number;
  skip: number;
}

/** Normalize `page`/`limit` query values into a safe pagination window. */
export function buildPagination(query: { page?: unknown; limit?: unknown }): Pagination {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(query.limit) || DEFAULT_LIMIT));
  return { page, limit, skip: (page - 1) * limit };
}

export function buildMeta(page: number, limit: number, total: number): PaginationMeta {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}
