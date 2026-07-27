import type { Request, Response } from "express";
import { membershipsService } from "./memberships.service";
import { sendSuccess } from "../../utils/api-response";
import { HttpStatus } from "../../constants/http-status";

export class MembershipsController {
  // public
  listPlans = async (_req: Request, res: Response) => {
    sendSuccess(res, await membershipsService.listPlans());
  };

  // customer
  listMine = async (req: Request, res: Response) => {
    sendSuccess(res, await membershipsService.listMine(req.user!.id));
  };
  subscribe = async (req: Request, res: Response) => {
    const result = await membershipsService.subscribe(req.user!.id, req.body as never);
    sendSuccess(res, result, "Checkout created", HttpStatus.CREATED);
  };
  cancel = async (req: Request, res: Response) => {
    sendSuccess(res, await membershipsService.cancel(req.user!.id, req.params.id), "Membership cancellation scheduled");
  };

  // admin
  listPlansAdmin = async (_req: Request, res: Response) => {
    sendSuccess(res, await membershipsService.listPlansAdmin());
  };
  createPlan = async (req: Request, res: Response) => {
    sendSuccess(res, await membershipsService.createPlan(req.body as never), "Plan created", HttpStatus.CREATED);
  };
  updatePlan = async (req: Request, res: Response) => {
    sendSuccess(res, await membershipsService.updatePlan(req.params.id, req.body as never), "Plan updated");
  };
}

export const membershipsController = new MembershipsController();
