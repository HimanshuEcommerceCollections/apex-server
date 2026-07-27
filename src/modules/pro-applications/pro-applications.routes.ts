import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { validate } from "../../middleware/validate";
import { formRateLimiter } from "../../middleware/rate-limit";
import { proApplicationsController } from "./pro-applications.controller";
import { createProApplicationSchema } from "./pro-applications.validation";

/** POST /api/v1/pro-applications — public Become-an-Apex-Pro form. */
export const proApplicationsRouter = Router();

proApplicationsRouter.post(
  "/",
  formRateLimiter,
  validate({ body: createProApplicationSchema }),
  asyncHandler(proApplicationsController.create),
);
