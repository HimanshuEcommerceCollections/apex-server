import type { Request, Response } from "express";
import { bookingsService } from "./bookings.service";
import { sendSuccess } from "../../utils/api-response";
import type { CreateBookingDto } from "./bookings.types";

export class BookingsController {
  // 200 for BOTH arms (BOOKED | WAITLISTED); the client branches on data.outcome.
  create = async (req: Request, res: Response) => {
    const result = await bookingsService.submit(req.user!.id, req.body as CreateBookingDto);
    sendSuccess(res, result, result.outcome === "BOOKED" ? "Booking received" : "Added to the waitlist");
  };

  listMine = async (req: Request, res: Response) => {
    sendSuccess(res, await bookingsService.listMine(req.user!.id));
  };

  getMine = async (req: Request, res: Response) => {
    sendSuccess(res, await bookingsService.getMine(req.user!.id, req.params.reference));
  };

  cancelMine = async (req: Request, res: Response) => {
    sendSuccess(res, await bookingsService.cancelMine(req.user!.id, req.params.reference), "Booking cancelled");
  };
}

export const bookingsController = new BookingsController();
