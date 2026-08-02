import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { validate } from "../../middleware/validate";
import { authorize } from "../../middleware/auth";
import { adminPmRequestsController } from "./pm-requests.admin.controller";
import {
  listPmRequestsQuerySchema,
  pmRequestIdParamSchema,
  triagePmRequestSchema,
} from "./pm-requests.validation";

/**
 * /api/v1/admin/pm-requests — mounted under the admin router (authenticate
 * applied). Gated on the same quote:read / quote:manage capabilities as the
 * Quotes screen, which both COORDINATOR and ADMIN already hold — screening a PM
 * enquiry IS quote triage, so it needs no new permission.
 */
export const adminPmRequestsRouter = Router();

adminPmRequestsRouter.get(
  "/",
  authorize("quote:read"),
  validate({ query: listPmRequestsQuerySchema }),
  asyncHandler(adminPmRequestsController.list),
);
adminPmRequestsRouter.get(
  "/:id",
  authorize("quote:read"),
  validate({ params: pmRequestIdParamSchema }),
  asyncHandler(adminPmRequestsController.get),
);
adminPmRequestsRouter.patch(
  "/:id",
  authorize("quote:manage"),
  validate({ params: pmRequestIdParamSchema, body: triagePmRequestSchema }),
  asyncHandler(adminPmRequestsController.triage),
);
