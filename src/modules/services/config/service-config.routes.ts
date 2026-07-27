import { Router } from "express";
import { asyncHandler } from "../../../utils/async-handler";
import { validate } from "../../../middleware/validate";
import { previewRateLimiter } from "../../../middleware/rate-limit";
import { serviceConfigController } from "./service-config.controller";
import { configParamSchema, pricePreviewBodySchema } from "./service-config.validation";

/** Nested under /services/:idOrSlug/config (mergeParams to see idOrSlug). */
export const serviceConfigRouter = Router({ mergeParams: true });

serviceConfigRouter.get(
  "/",
  validate({ params: configParamSchema }),
  asyncHandler(serviceConfigController.getConfig),
);

serviceConfigRouter.post(
  "/price",
  previewRateLimiter,
  validate({ params: configParamSchema, body: pricePreviewBodySchema }),
  asyncHandler(serviceConfigController.price),
);
