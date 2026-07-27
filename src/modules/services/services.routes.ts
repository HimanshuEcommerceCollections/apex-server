import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { validate } from "../../middleware/validate";
import { servicesController } from "./services.controller";
import { idOrSlugParamSchema, listServicesQuerySchema } from "./services.validation";
import { serviceConfigRouter } from "./config/service-config.routes";

export const servicesRouter = Router();

servicesRouter.get(
  "/",
  validate({ query: listServicesQuerySchema }),
  asyncHandler(servicesController.list),
);

// Nested configurator sub-router (GET config, POST config/price).
servicesRouter.use("/:idOrSlug/config", serviceConfigRouter);

servicesRouter.get(
  "/:idOrSlug",
  validate({ params: idOrSlugParamSchema }),
  asyncHandler(servicesController.detail),
);
