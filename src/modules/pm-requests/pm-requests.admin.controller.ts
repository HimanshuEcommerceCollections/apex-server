import type { Request, Response } from "express";
import { pmRequestsService } from "./pm-requests.service";
import { sendSuccess } from "../../utils/api-response";
import { HttpStatus } from "../../constants/http-status";

export class AdminPmRequestsController {
  list = async (req: Request, res: Response) => {
    const { requests, meta } = await pmRequestsService.list(req.query as never);
    sendSuccess(res, requests, "Success", HttpStatus.OK, meta);
  };

  get = async (req: Request, res: Response) => {
    sendSuccess(res, await pmRequestsService.getOrThrow(req.params.id));
  };

  triage = async (req: Request, res: Response) => {
    const changes = req.body as { quotedAmount?: number; status?: string };
    sendSuccess(res, await pmRequestsService.triage(req.params.id, changes, req.user!.id), "Request updated");
  };
}

export const adminPmRequestsController = new AdminPmRequestsController();
