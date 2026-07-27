import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { validate } from "../../middleware/validate";
import { serviceAreaController } from "./service-area.controller";
import { validateQuerySchema } from "./service-area.validation";

/** Public service-area routes. */
export const serviceAreaRouter = Router();

serviceAreaRouter.get("/areas", asyncHandler(serviceAreaController.areas));
serviceAreaRouter.get(
  "/validate",
  validate({ query: validateQuerySchema }),
  asyncHandler(serviceAreaController.validate),
);
