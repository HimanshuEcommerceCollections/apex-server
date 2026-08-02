import type { Request, Response } from "express";
import { catalogService } from "./catalog.service";
import { sendSuccess } from "../../utils/api-response";
import type { PricingUpdate, RecurringPlanInput } from "./catalog.repository";

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

  getRecurring = async (req: Request, res: Response) => {
    sendSuccess(res, await catalogService.getRecurring(req.params.idOrSlug));
  };

  putRecurring = async (req: Request, res: Response) => {
    const view = await catalogService.replaceRecurring(
      req.params.idOrSlug,
      req.body as { heading?: string | null; plans: RecurringPlanInput[] },
      req.user!.id,
      req.ip,
    );
    sendSuccess(res, view, "Recurring plans updated");
  };
}

export const adminCatalogController = new AdminCatalogController();
