import type { Request, Response } from "express";
import { catalogService } from "./catalog.service";
import { sendSuccess } from "../../utils/api-response";
import type { PricingUpdate } from "./catalog.repository";

export class AdminCatalogController {
  get = async (req: Request, res: Response) => {
    sendSuccess(res, await catalogService.getForEdit(req.params.idOrSlug));
  };

  updatePricing = async (req: Request, res: Response) => {
    const view = await catalogService.updatePricing(
      req.params.idOrSlug,
      req.body as PricingUpdate,
      req.user!.id,
      req.ip,
    );
    sendSuccess(res, view, "Pricing updated");
  };
}

export const adminCatalogController = new AdminCatalogController();
