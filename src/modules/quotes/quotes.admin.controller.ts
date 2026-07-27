import type { Request, Response } from "express";
import { quotesService } from "./quotes.service";
import { sendSuccess } from "../../utils/api-response";
import { HttpStatus } from "../../constants/http-status";

export class AdminQuotesController {
  list = async (req: Request, res: Response) => {
    const { quotes, meta } = await quotesService.list(req.query as never);
    sendSuccess(res, quotes, "Success", HttpStatus.OK, meta);
  };

  update = async (req: Request, res: Response) => {
    const changes = req.body as { quotedAmount?: number; status?: string };
    sendSuccess(res, await quotesService.setQuote(req.params.id, changes, req.user!.id), "Quote updated");
  };
}

export const adminQuotesController = new AdminQuotesController();
