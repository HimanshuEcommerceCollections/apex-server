import type { Prisma } from "@prisma/client";
import type { FormKind } from "../../enums";
import { demoInboxRepository } from "./demo-inbox.repository";
import { logger } from "../../utils/logger";

/**
 * Appends a FormSubmissionLog row after each successful form write (the demo
 * inbox feed). Best-effort by design: a failure is logged, never thrown — it
 * must never roll back or fail a real submission.
 */
export class DemoInboxService {
  async record(kind: FormKind, entityId: string | null, payload: unknown): Promise<void> {
    try {
      await demoInboxRepository.create({
        kind,
        entityId,
        payload: (payload ?? {}) as Prisma.InputJsonValue,
      });
    } catch (err) {
      logger.warn(`demo-inbox record failed (${kind})`, err);
    }
  }
}

export const demoInboxService = new DemoInboxService();
