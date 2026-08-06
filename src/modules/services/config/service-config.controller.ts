import type { Request, Response } from "express";
import { serviceConfigService } from "./service-config.service";
import { sendSuccess } from "../../../utils/api-response";

export class ServiceConfigController {
  getConfig = async (req: Request, res: Response) => {
    sendSuccess(res, await serviceConfigService.getConfig(req.params.idOrSlug));
  };

  price = async (req: Request, res: Response) => {
    const body = req.body as {
      selections: Record<string, string | number | boolean | string[]>;
      quantity?: number;
      cadenceId?: string;
    };
    const preview = await serviceConfigService.price(req.params.idOrSlug, {
      selections: body.selections,
      quantity: body.quantity,
      // Without this the chosen frequency is silently dropped and the estimate
      // comes back undiscounted while the UI shows the frequency as selected.
      cadenceId: body.cadenceId,
    });
    sendSuccess(res, preview);
  };
}

export const serviceConfigController = new ServiceConfigController();
