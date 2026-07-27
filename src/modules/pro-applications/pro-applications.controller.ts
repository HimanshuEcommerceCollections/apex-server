import type { Request, Response } from "express";
import { proApplicationsService, type CreateProApplicationDto } from "./pro-applications.service";
import { sendSuccess } from "../../utils/api-response";
import { HttpStatus } from "../../constants/http-status";

export class ProApplicationsController {
  create = async (req: Request, res: Response) => {
    const result = await proApplicationsService.submit(req.body as CreateProApplicationDto);
    sendSuccess(res, result, "Application received", HttpStatus.CREATED);
  };
}

export const proApplicationsController = new ProApplicationsController();
