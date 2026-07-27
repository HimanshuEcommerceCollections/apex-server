import type { Request, Response } from "express";
import { usersService } from "./users.service";
import { sendSuccess } from "../../utils/api-response";
import type { UpdateMeDto } from "./users.types";

export class UsersController {
  getMe = async (req: Request, res: Response) => {
    const profile = await usersService.getProfileOrThrow(req.user!.id);
    sendSuccess(res, profile);
  };

  updateMe = async (req: Request, res: Response) => {
    const profile = await usersService.updateProfile(req.user!.id, req.body as UpdateMeDto);
    sendSuccess(res, profile, "Profile updated");
  };
}

export const usersController = new UsersController();
