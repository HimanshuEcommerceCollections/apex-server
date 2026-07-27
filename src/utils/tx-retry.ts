import { Prisma } from "@prisma/client";
import { logger } from "./logger";

/** Postgres write-conflict / deadlock codes worth retrying. */
const RETRYABLE = new Set(["P2034"]);

/**
 * Retry a transaction thunk on serialization/deadlock conflicts. Used by the
 * booking pipeline where the reference-counter increment can serialize under
 * contention (docs/architecture/06).
 */
export async function withTxRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable =
        err instanceof Prisma.PrismaClientKnownRequestError && RETRYABLE.has(err.code);
      if (!retryable || attempt === maxAttempts) break;
      logger.warn(`tx conflict (attempt ${attempt}/${maxAttempts}), retrying`);
      await new Promise((r) => setTimeout(r, 25 * attempt));
    }
  }
  throw lastErr;
}
