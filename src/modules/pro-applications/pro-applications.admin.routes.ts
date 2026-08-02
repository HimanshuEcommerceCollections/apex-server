import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { validate } from "../../middleware/validate";
import { authorize } from "../../middleware/auth";
import { adminProApplicationsController } from "./pro-applications.admin.controller";
import {
  listProApplicationsQuerySchema,
  proApplicationIdParamSchema,
  screenProApplicationSchema,
} from "./pro-applications.validation";

/**
 * /api/v1/admin/pro-applications — mounted under the admin router (authenticate
 * applied). Gated on `pro:manage`, the existing pro-triage capability that both
 * COORDINATOR and ADMIN already hold, so no new permission is introduced.
 */
export const adminProApplicationsRouter = Router();

adminProApplicationsRouter.get(
  "/",
  authorize("pro:manage"),
  validate({ query: listProApplicationsQuerySchema }),
  asyncHandler(adminProApplicationsController.list),
);
adminProApplicationsRouter.get(
  "/:id",
  authorize("pro:manage"),
  validate({ params: proApplicationIdParamSchema }),
  asyncHandler(adminProApplicationsController.get),
);
adminProApplicationsRouter.patch(
  "/:id",
  authorize("pro:manage"),
  validate({ params: proApplicationIdParamSchema, body: screenProApplicationSchema }),
  asyncHandler(adminProApplicationsController.screen),
);
