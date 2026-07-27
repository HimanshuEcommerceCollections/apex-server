import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { validate } from "../../middleware/validate";
import { authorize } from "../../middleware/auth";
import { adminBookingsController } from "./bookings.admin.controller";
import {
  bookingReferenceParamSchema,
  listBookingsQuerySchema,
  transitionBookingSchema,
} from "./bookings.validation";

/** /api/v1/admin/bookings — mounted under the admin router (authenticate applied). */
export const adminBookingsRouter = Router();

adminBookingsRouter.get(
  "/",
  authorize("booking:read:any"),
  validate({ query: listBookingsQuerySchema }),
  asyncHandler(adminBookingsController.list),
);
adminBookingsRouter.get(
  "/:reference",
  authorize("booking:read:any"),
  validate({ params: bookingReferenceParamSchema }),
  asyncHandler(adminBookingsController.detail),
);
adminBookingsRouter.patch(
  "/:reference",
  authorize("booking:transition"),
  validate({ params: bookingReferenceParamSchema, body: transitionBookingSchema }),
  asyncHandler(adminBookingsController.transition),
);
