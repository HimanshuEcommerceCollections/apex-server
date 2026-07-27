import type { Prisma } from "@prisma/client";
import { auditRepository } from "./audit.repository";
import { logger } from "../../utils/logger";

export interface AuditEntry {
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/** Append an admin audit-log row. Best-effort: never fails the caller. */
export class AuditService {
  async record(entry: AuditEntry): Promise<void> {
    try {
      await auditRepository.create({
        actorUserId: entry.actorUserId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before: (entry.before ?? undefined) as Prisma.InputJsonValue | undefined,
        after: (entry.after ?? undefined) as Prisma.InputJsonValue | undefined,
        ip: entry.ip ?? null,
      });
    } catch (err) {
      logger.warn(`audit record failed (${entry.action})`, err);
    }
  }
}

export const auditService = new AuditService();
