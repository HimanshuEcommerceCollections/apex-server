import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { validate } from "../../middleware/validate";
import { authorize } from "../../middleware/auth";
import { serviceAreaController } from "./service-area.controller";
import { coverageParamSchema, setCoverageBodySchema } from "./service-area.validation";

/** /api/v1/admin/coverage/:serviceId — per-service area grants + ZIP overrides. */
export const adminCoverageRouter = Router();

adminCoverageRouter.use(authorize("geo:manage"));

adminCoverageRouter.get(
  "/:serviceId",
  validate({ params: coverageParamSchema }),
  asyncHandler(serviceAreaController.getCoverage),
);
adminCoverageRouter.put(
  "/:serviceId",
  validate({ params: coverageParamSchema, body: setCoverageBodySchema }),
  asyncHandler(serviceAreaController.setCoverage),
);
