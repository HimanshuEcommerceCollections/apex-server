import type { Request, Response } from "express";
import { bookingsService } from "./bookings.service";
import { sendSuccess } from "../../utils/api-response";
import { HttpStatus } from "../../constants/http-status";

export class AdminBookingsController {
  list = async (req: Request, res: Response) => {
    const { bookings, meta } = await bookingsService.adminList(req.query as never);
    sendSuccess(res, bookings, "Success", HttpStatus.OK, meta);
  };

  detail = async (req: Request, res: Response) => {
    sendSuccess(res, await bookingsService.adminGet(req.params.reference));
  };

  transition = async (req: Request, res: Response) => {
    const changes = req.body as { status?: string; scheduledAt?: Date };
    sendSuccess(res, await bookingsService.adminTransition(req.params.reference, changes), "Booking updated");
  };
}

export const adminBookingsController = new AdminBookingsController();
