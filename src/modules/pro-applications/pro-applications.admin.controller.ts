import type { Request, Response } from "express";
import { proApplicationsService } from "./pro-applications.service";
import { sendSuccess } from "../../utils/api-response";
import { HttpStatus } from "../../constants/http-status";

export class AdminProApplicationsController {
  list = async (req: Request, res: Response) => {
    const { applications, meta } = await proApplicationsService.list(req.query as never);
    sendSuccess(res, applications, "Success", HttpStatus.OK, meta);
  };

  get = async (req: Request, res: Response) => {
    sendSuccess(res, await proApplicationsService.getOrThrow(req.params.id));
  };

  screen = async (req: Request, res: Response) => {
    const changes = req.body as { status?: string; notes?: string | null };
    sendSuccess(res, await proApplicationsService.screen(req.params.id, changes), "Application updated");
  };
}

export const adminProApplicationsController = new AdminProApplicationsController();
