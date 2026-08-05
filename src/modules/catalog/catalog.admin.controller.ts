import type { Request, Response } from "express";
import { catalogService, type Actor } from "./catalog.service";
import { sendSuccess } from "../../utils/api-response";
import type { PricingUpdate } from "./catalog.repository";

const actorOf = (req: Request): Actor => ({ userId: req.user!.id, ip: req.ip });

export class AdminCatalogController {
  get = async (req: Request, res: Response) => {
    sendSuccess(res, await catalogService.getForEdit(req.params.idOrSlug));
  };

  updatePricing = async (req: Request, res: Response) => {
    const view = await catalogService.updatePricing(req.params.idOrSlug, req.body as PricingUpdate, actorOf(req));
    sendSuccess(res, view, "Pricing updated");
  };

  // ── Configurations ─────────────────────────────────────────────────────────

  createGroup = async (req: Request, res: Response) => {
    sendSuccess(res, await catalogService.createGroup(req.params.idOrSlug, req.body, actorOf(req)), "Configuration added");
  };

  patchGroup = async (req: Request, res: Response) => {
    sendSuccess(
      res,
      await catalogService.patchGroup(req.params.idOrSlug, req.params.groupId, req.body, actorOf(req)),
      "Configuration updated",
    );
  };

  createOption = async (req: Request, res: Response) => {
    sendSuccess(
      res,
      await catalogService.createOption(req.params.idOrSlug, req.params.groupId, req.body, actorOf(req)),
      "Option added",
    );
  };

  patchOption = async (req: Request, res: Response) => {
    sendSuccess(
      res,
      await catalogService.patchOption(req.params.idOrSlug, req.params.id, req.body, actorOf(req)),
      "Option updated",
    );
  };

  // ── Recurring grid ─────────────────────────────────────────────────────────

  putRecurring = async (req: Request, res: Response) => {
    const view = await catalogService.putRecurring(
      req.params.idOrSlug,
      (req.body as { rows: { cadenceId: string; discountPercent: number; isActive: boolean }[] }).rows,
      actorOf(req),
    );
    sendSuccess(res, view, "Recurring settings updated");
  };

  // ── Global cadences ────────────────────────────────────────────────────────

  listCadences = async (_req: Request, res: Response) => {
    sendSuccess(res, await catalogService.listCadences());
  };

  createCadence = async (req: Request, res: Response) => {
    sendSuccess(res, await catalogService.createCadence(req.body, actorOf(req)), "Cadence created");
  };

  patchCadence = async (req: Request, res: Response) => {
    sendSuccess(res, await catalogService.patchCadence(req.params.id, req.body, actorOf(req)), "Cadence updated");
  };

  // ── Plans ──────────────────────────────────────────────────────────────────

  listPlans = async (_req: Request, res: Response) => {
    sendSuccess(res, await catalogService.listPlans());
  };

  createPlan = async (req: Request, res: Response) => {
    sendSuccess(res, await catalogService.createPlan(req.body, actorOf(req)), "Plan created");
  };

  patchPlan = async (req: Request, res: Response) => {
    sendSuccess(res, await catalogService.patchPlan(req.params.id, req.body, actorOf(req)), "Plan updated");
  };
}

export const adminCatalogController = new AdminCatalogController();
