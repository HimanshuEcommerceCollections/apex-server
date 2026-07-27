import type { Request, Response } from "express";
import { healthService } from "./health.service";
import { sendSuccess } from "../../utils/api-response";

export class HealthController {
  get = async (_req: Request, res: Response) => {
    const data = await healthService.getHealth();
    sendSuccess(res, data, "OK");
  };
}

export const healthController = new HealthController();
