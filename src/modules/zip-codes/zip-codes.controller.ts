import type { Request, Response } from "express";
import { zipCodesService } from "./zip-codes.service";
import { sendSuccess } from "../../utils/api-response";
import { HttpStatus } from "../../constants/http-status";

export class ZipCodesController {
  list = async (req: Request, res: Response) => {
    const { zipCodes, meta } = await zipCodesService.list(req.query as never);
    sendSuccess(res, zipCodes, "Success", HttpStatus.OK, meta);
  };

  create = async (req: Request, res: Response) => {
    sendSuccess(res, await zipCodesService.create(req.body as never), "ZIP code created", HttpStatus.CREATED);
  };

  update = async (req: Request, res: Response) => {
    sendSuccess(res, await zipCodesService.update(req.params.id, req.body as never), "ZIP code updated");
  };

  remove = async (req: Request, res: Response) => {
    await zipCodesService.softDelete(req.params.id);
    sendSuccess(res, { deleted: true }, "ZIP code deleted");
  };
}

export const zipCodesController = new ZipCodesController();
