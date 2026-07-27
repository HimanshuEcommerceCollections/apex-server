import type { Request, Response } from "express";
import { waitlistService } from "./waitlist.service";
import { sendSuccess } from "../../utils/api-response";
import { HttpStatus } from "../../constants/http-status";
import type { CreateWaitlistSignupDto } from "./waitlist.types";

export class WaitlistController {
  create = async (req: Request, res: Response) => {
    const { signup, created } = await waitlistService.signup(req.body as CreateWaitlistSignupDto);
    sendSuccess(
      res,
      { waitlist_signup: signup, created },
      created ? "Joined the waitlist" : "Already on the waitlist",
      created ? HttpStatus.CREATED : HttpStatus.OK,
    );
  };
}

export const waitlistController = new WaitlistController();
