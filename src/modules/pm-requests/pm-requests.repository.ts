import type { Prisma } from "@prisma/client";
import { PMBundle, QuoteSource } from "@prisma/client";
import { prisma } from "../../db/client";

interface CreatePmInput {
  company: string | null;
  unitsEst: number;
  bundle: PMBundle;
  scopeNotes: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
}

// Triage state (status, price) and the contact live on the parent QuoteRequest,
// so every admin read joins it.
const include = {
  quoteRequest: {
    select: {
      id: true,
      status: true,
      contactName: true,
      contactEmail: true,
      contactPhone: true,
      quotedAmount: true,
      quotedAt: true,
      currency: true,
    },
  },
} as const;

export type PmRequestWithQuote = Prisma.PMRequestGetPayload<{ include: typeof include }>;

export interface PmRequestListFilter {
  status?: string;
  bundle?: string;
  search?: string;
  skip: number;
  take: number;
}

/**
 * Sole writer of PMRequest. Creates the PMRequest and its parent QuoteRequest
 * (source PM_FORM) atomically as one nested create (same atomic-unit pattern as
 * the booking pipeline).
 */
export class PmRequestsRepository {
  createWithQuote(input: CreatePmInput) {
    return prisma.pMRequest.create({
      data: {
        company: input.company,
        unitsEst: input.unitsEst,
        bundle: input.bundle,
        scopeNotes: input.scopeNotes,
        quoteRequest: {
          create: {
            description: input.scopeNotes,
            source: QuoteSource.PM_FORM,
            contactName: input.contactName,
            contactEmail: input.contactEmail,
            contactPhone: input.contactPhone,
          },
        },
      },
      include: { quoteRequest: { select: { id: true } } },
    });
  }

  /** Coordinator triage queue: newest first. Filters AND together. */
  async listAndCount(f: PmRequestListFilter) {
    const where: Prisma.PMRequestWhereInput = {};
    if (f.bundle) where.bundle = f.bundle as PMBundle;
    if (f.status) where.quoteRequest = { status: f.status as never };
    if (f.search) {
      where.OR = [
        { company: { contains: f.search, mode: "insensitive" } },
        { quoteRequest: { contactName: { contains: f.search, mode: "insensitive" } } },
        { quoteRequest: { contactEmail: { contains: f.search, mode: "insensitive" } } },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.pMRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: f.skip,
        take: f.take,
        include,
      }),
      prisma.pMRequest.count({ where }),
    ]);
    return { rows, total };
  }

  findById(id: string) {
    return prisma.pMRequest.findUnique({ where: { id }, include });
  }
}

export const pmRequestsRepository = new PmRequestsRepository();
