import { healthRepository } from "./health.repository";
import { ApiError } from "../../utils/api-error";
import { Messages } from "../../constants/messages";

export interface HealthStatus {
  status: "ok";
  db: "up";
  version: string;
}

const VERSION = process.env.npm_package_version ?? "0.1.0";

export class HealthService {
  /** 503 DB_UNAVAILABLE if the DB ping fails; otherwise a healthy snapshot. */
  async getHealth(): Promise<HealthStatus> {
    try {
      await healthRepository.pingDb();
    } catch {
      throw ApiError.serviceUnavailable(Messages.DB_UNAVAILABLE, { code: "DB_UNAVAILABLE" });
    }
    return { status: "ok", db: "up", version: VERSION };
  }
}

export const healthService = new HealthService();
