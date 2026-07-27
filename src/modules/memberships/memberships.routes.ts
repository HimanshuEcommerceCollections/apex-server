import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { validate } from "../../middleware/validate";
import { authenticate, authorize } from "../../middleware/auth";
import { membershipsController } from "./memberships.controller";
import {
  createPlanSchema,
  membershipIdParamSchema,
  planIdParamSchema,
  subscribeSchema,
  updatePlanSchema,
} from "./memberships.validation";

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

/** Admin: /api/v1/admin/membership-plans (membership:manage). */
export const adminMembershipPlansRouter = Router();
adminMembershipPlansRouter.use(authorize("membership:manage"));
adminMembershipPlansRouter.get("/", asyncHandler(membershipsController.listPlansAdmin));
adminMembershipPlansRouter.post("/", validate({ body: createPlanSchema }), asyncHandler(membershipsController.createPlan));
adminMembershipPlansRouter.patch(
  "/:id",
  validate({ params: planIdParamSchema, body: updatePlanSchema }),
  asyncHandler(membershipsController.updatePlan),
);
