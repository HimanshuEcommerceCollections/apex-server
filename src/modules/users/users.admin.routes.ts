import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { validate } from "../../middleware/validate";
import { authorize } from "../../middleware/auth";
import { adminUsersController } from "./users.admin.controller";
import {
  inviteStaffSchema,
  listStaffQuerySchema,
  staffIdParamSchema,
  updateStaffSchema,
} from "./users.validation";

/**
 * /api/v1/admin/users — staff management (mounted under the admin router which
 * already applies `authenticate`). Every route requires `user:manage` (ADMIN).
 */
export const adminUsersRouter = Router();

adminUsersRouter.get(
  "/",
  authorize("user:manage"),
  validate({ query: listStaffQuerySchema }),
  asyncHandler(adminUsersController.list),
);

adminUsersRouter.post(
  "/",
  authorize("user:manage"),
  validate({ body: inviteStaffSchema }),
  asyncHandler(adminUsersController.invite),
);

adminUsersRouter.patch(
  "/:id",
  authorize("user:manage"),
  validate({ params: staffIdParamSchema, body: updateStaffSchema }),
  asyncHandler(adminUsersController.update),
);

// Soft-delete an account — the console calls this both to revoke a pending
// invite and to offboard an active member. The row is retained (operational
// history references it) but every lookup filters it out, so the account can no
// longer sign in or redeem an outstanding invite link.
adminUsersRouter.delete(
  "/:id",
  authorize("user:manage"),
  validate({ params: staffIdParamSchema }),
  asyncHandler(adminUsersController.remove),
);
