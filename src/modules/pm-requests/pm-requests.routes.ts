import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { validate } from "../../middleware/validate";
import { formRateLimiter } from "../../middleware/rate-limit";
import { pmRequestsController } from "./pm-requests.controller";
import { createPmRequestSchema } from "./pm-requests.validation";

/** POST /api/v1/pm-requests — public B2B property-manager form. */
export const pmRequestsRouter = Router();

pmRequestsRouter.post(
  "/",
  formRateLimiter,
  validate({ body: createPmRequestSchema }),
  asyncHandler(pmRequestsController.create),
);
