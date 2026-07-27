import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/client";

/** Sole writer of AdminAuditLog (append-only). */
export class AuditRepository {
  create(data: Prisma.AdminAuditLogUncheckedCreateInput) {
    return prisma.adminAuditLog.create({ data });
  }
}

export const auditRepository = new AuditRepository();
