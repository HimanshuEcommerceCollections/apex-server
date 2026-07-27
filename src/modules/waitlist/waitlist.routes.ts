import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { validate } from "../../middleware/validate";
import { formRateLimiter } from "../../middleware/rate-limit";
import { waitlistController } from "./waitlist.controller";
import { createWaitlistSignupSchema } from "./waitlist.validation";

export const waitlistRouter = Router();

// PUBLIC capture (a zip miss must never dead-end). Public form POSTs carry the
// stricter formRateLimiter on top of the general /api limiter.
waitlistRouter.post(
  "/",
  formRateLimiter,
  validate({ body: createWaitlistSignupSchema }),
  asyncHandler(waitlistController.create),
);
