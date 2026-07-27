import type { z } from "zod";
import { PMBundle, FormKind } from "../../enums";
import { pmRequestsRepository } from "./pm-requests.repository";
import { demoInboxService } from "../demo-inbox";
import type { createPmRequestSchema } from "./pm-requests.validation";

export type CreatePmRequestDto = z.infer<typeof createPmRequestSchema>;

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
}

export const pmRequestsService = new PmRequestsService();
