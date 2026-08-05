import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { validate } from "../../middleware/validate";
import { authenticate } from "../../middleware/auth";
import { membershipsController } from "./memberships.controller";
import { membershipIdParamSchema, subscribeSchema } from "./memberships.validation";

// The old /admin/membership-plans router is gone: plans ARE ServicePlan now,
// managed at /admin/catalog/plans (catalog module).

/** Public: GET /api/v1/membership/plans. */
export const membershipRouter = Router();
membershipRouter.get("/plans", asyncHandler(membershipsController.listPlans));

/** Customer: /api/v1/me/memberships. */
export const meMembershipsRouter = Router();
meMembershipsRouter.use(authenticate);
meMembershipsRouter.get("/", asyncHandler(membershipsController.listMine));
meMembershipsRouter.post("/", validate({ body: subscribeSchema }), asyncHandler(membershipsController.subscribe));
meMembershipsRouter.delete(
  "/:id",
  validate({ params: membershipIdParamSchema }),
  asyncHandler(membershipsController.cancel),
);
