import type { z } from "zod";
import type { Prisma } from "@prisma/client";
import { FormKind } from "../../enums";
import { ApiError } from "../../utils/api-error";
import { proApplicationsRepository } from "./pro-applications.repository";
import { servicesRepository } from "../services";
import { demoInboxService } from "../demo-inbox";
import type { createProApplicationSchema } from "./pro-applications.validation";

export type CreateProApplicationDto = z.infer<typeof createProApplicationSchema>;

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
    });
    await demoInboxService.record(FormKind.PRO_APPLICATION, row.id, dto);
    return { application_id: row.id };
  }
}

export const proApplicationsService = new ProApplicationsService();
