import type { Request, Response } from "express";
import { areasService } from "./areas.service";
import { sendSuccess } from "../../utils/api-response";
import { HttpStatus } from "../../constants/http-status";

export class AreasController {
  list = async (req: Request, res: Response) => {
    const q = req.query as {
      search?: string;
      status?: "ACTIVE" | "INACTIVE";
      includeDeleted?: boolean;
      page?: number;
      limit?: number;
    };
    const { areas, meta } = await areasService.list(q);
    sendSuccess(res, areas, "Success", HttpStatus.OK, meta);
  };

  create = async (req: Request, res: Response) => {
    const { name } = req.body as { name: string };
    sendSuccess(res, await areasService.create(name), "Area created", HttpStatus.CREATED);
  };

  update = async (req: Request, res: Response) => {
    const changes = req.body as { name?: string; status?: "ACTIVE" | "INACTIVE" };
    sendSuccess(res, await areasService.update(req.params.id, changes), "Area updated");
  };

  remove = async (req: Request, res: Response) => {
    await areasService.softDelete(req.params.id);
    sendSuccess(res, { deleted: true }, "Area deleted");
  };

  restore = async (req: Request, res: Response) => {
    sendSuccess(res, await areasService.restore(req.params.id), "Area restored");
  };
}

export const areasController = new AreasController();
