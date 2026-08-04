import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/client";

const include = {
  // configuration feeds the coordinator's indicative engine price (quotes.service).
  booking: {
    select: {
      reference: true,
      configuration: { select: { selections: true, quantity: true } },
    },
  },
  service: { select: { slug: true, name: true } },
} as const;

export type QuoteWithRefs = Prisma.QuoteRequestGetPayload<{ include: typeof include }>;

export class QuotesRepository {
  async listAndCount(f: {
    status?: string;
    source?: string;
    search?: string;
    skip: number;
    take: number;
  }) {
    const where: Prisma.QuoteRequestWhereInput = {};
    if (f.status) where.status = f.status as never;
    if (f.source) where.source = f.source as never;
    if (f.search) {
      where.OR = [
        { contactEmail: { contains: f.search, mode: "insensitive" } },
        { contactName: { contains: f.search, mode: "insensitive" } },
      ];
    }
    const [rows, total] = await Promise.all([
      prisma.quoteRequest.findMany({ where, orderBy: { createdAt: "desc" }, skip: f.skip, take: f.take, include }),
      prisma.quoteRequest.count({ where }),
    ]);
    return { rows, total };
  }

  findById(id: string) {
    return prisma.quoteRequest.findUnique({ where: { id }, include });
  }

  /** Create a QuoteRequest; tx-aware so callers (pm-requests) can share a transaction. */
  create(
    data: Prisma.QuoteRequestUncheckedCreateInput,
    client: Prisma.TransactionClient = prisma,
  ) {
    return client.quoteRequest.create({ data });
  }

  update(id: string, data: Prisma.QuoteRequestUncheckedUpdateInput) {
    return prisma.quoteRequest.update({ where: { id }, data, include });
  }
}

export const quotesRepository = new QuotesRepository();
