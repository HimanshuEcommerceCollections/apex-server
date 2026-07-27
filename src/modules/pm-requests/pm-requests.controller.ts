import type { Request, Response } from "express";
import { pmRequestsService, type CreatePmRequestDto } from "./pm-requests.service";
import { sendSuccess } from "../../utils/api-response";
import { HttpStatus } from "../../constants/http-status";

export class PmRequestsController {
  create = async (req: Request, res: Response) => {
    const result = await pmRequestsService.submit(req.body as CreatePmRequestDto);
    sendSuccess(res, result, "Request received", HttpStatus.CREATED);
  };
}

export const pmRequestsController = new PmRequestsController();
