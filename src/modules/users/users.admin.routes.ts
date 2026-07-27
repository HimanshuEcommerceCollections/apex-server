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
