import { prisma } from "../../db/client";

export class HealthRepository {
  /** Cheap liveness probe against the DB. */
  async pingDb(): Promise<void> {
    await prisma.$queryRaw`SELECT 1`;
  }
}

export const healthRepository = new HealthRepository();
