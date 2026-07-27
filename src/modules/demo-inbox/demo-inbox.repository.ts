import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/client";

/** Sole writer of FormSubmissionLog (the append-only demo inbox). */
export class DemoInboxRepository {
  create(data: Prisma.FormSubmissionLogUncheckedCreateInput) {
    return prisma.formSubmissionLog.create({ data });
  }
}

export const demoInboxRepository = new DemoInboxRepository();
