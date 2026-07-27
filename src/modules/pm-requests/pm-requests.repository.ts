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
}

export const pmRequestsRepository = new PmRequestsRepository();
