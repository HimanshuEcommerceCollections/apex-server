import type { Request, Response } from "express";
import { usersService } from "./users.service";
import { sendSuccess } from "../../utils/api-response";
import { HttpStatus } from "../../constants/http-status";
import { Role } from "../../enums";

export class AdminUsersController {
  list = async (req: Request, res: Response) => {
    const role = (req.query as { role?: Role }).role;
    sendSuccess(res, await usersService.listStaff(role));
  };

  invite = async (req: Request, res: Response) => {
    const body = req.body as { email: string; name: string; role: Role; phone?: string };
    const profile = await usersService.inviteStaff(body);
    sendSuccess(res, profile, "Invitation sent", HttpStatus.CREATED);
  };

  update = async (req: Request, res: Response) => {
    const changes = req.body as { status?: "ACTIVE" | "SUSPENDED"; role?: Role };
    const profile = await usersService.updateStaff(req.params.id, changes);
    sendSuccess(res, profile, "Staff updated");
  };
}

export const adminUsersController = new AdminUsersController();
