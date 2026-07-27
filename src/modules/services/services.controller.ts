import type { Request, Response } from "express";
import { servicesService } from "./services.service";
import { sendSuccess } from "../../utils/api-response";
import type { ServiceStatus } from "../../enums";

export class ServicesController {
  list = async (req: Request, res: Response) => {
    const q = req.query as { status?: ServiceStatus; category?: string };
    const data = await servicesService.list({ status: q.status, categorySlug: q.category });
    sendSuccess(res, data);
  };

  detail = async (req: Request, res: Response) => {
    const data = await servicesService.getByIdOrSlug(req.params.idOrSlug);
    sendSuccess(res, data);
  };
}

export const servicesController = new ServicesController();
