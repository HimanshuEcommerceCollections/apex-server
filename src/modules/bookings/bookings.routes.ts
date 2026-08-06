import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { validate } from "../../middleware/validate";
import { authenticate } from "../../middleware/auth";
import { formRateLimiter } from "../../middleware/rate-limit";
import { bookingsController } from "./bookings.controller";
import { bookingReferenceParamSchema, createBookingSchema } from "./bookings.validation";

/** POST /api/v1/bookings — authenticated Core Flow submit (accounts required). */
export const bookingsRouter = Router();

bookingsRouter.post(
  "/",
  formRateLimiter,
  authenticate,
  validate({ body: createBookingSchema }),
  asyncHandler(bookingsController.create),
);

/** /api/v1/me/bookings — the authenticated customer's own bookings (ownership-scoped). */
export const meBookingsRouter = Router();

meBookingsRouter.use(authenticate);
meBookingsRouter.get("/", asyncHandler(bookingsController.listMine));
meBookingsRouter.get(
  "/:reference",
  validate({ params: bookingReferenceParamSchema }),
  asyncHandler(bookingsController.getMine),
);
// Customer cancel — unpaid FROM bookings only (voids any open PaymentIntent).
meBookingsRouter.post(
  "/:reference/cancel",
  validate({ params: bookingReferenceParamSchema }),
  asyncHandler(bookingsController.cancelMine),
);
