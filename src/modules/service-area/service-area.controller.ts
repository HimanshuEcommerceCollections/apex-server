import type { Request, Response } from "express";
import { availabilityService, coverageService } from "./service-area.service";
import { areasService } from "../areas";
import { sendSuccess } from "../../utils/api-response";

export class ServiceAreaController {
  // --- public ---
  areas = async (_req: Request, res: Response) => {
    sendSuccess(res, await areasService.listPublic());
  };

  validate = async (req: Request, res: Response) => {
    const { zip, service } = req.query as { zip: string; service?: string };
    const result = service
      ? await availabilityService.isServiceAvailable(service, zip)
      : await availabilityService.validateZip(zip);
    sendSuccess(res, result);
  };

  // --- admin coverage ---
  getCoverage = async (req: Request, res: Response) => {
    sendSuccess(res, await coverageService.getCoverage(req.params.serviceId));
  };

  setCoverage = async (req: Request, res: Response) => {
    const body = req.body as {
      areaIds: string[];
      zipOverrides: { zipCodeId: string; effect: "INCLUDE" | "EXCLUDE" }[];
    };
    sendSuccess(res, await coverageService.setCoverage(req.params.serviceId, body), "Coverage updated");
  };
}

export const serviceAreaController = new ServiceAreaController();
