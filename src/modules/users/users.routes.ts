import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { authenticate } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { usersController } from "./users.controller";
import { updateMeSchema } from "./users.validation";

/** `/api/v1/me` — the authenticated user's own profile (ownership-scoped). */
export const meRouter = Router();

meRouter.use(authenticate);
meRouter.get("/", asyncHandler(usersController.getMe));
meRouter.patch("/", validate({ body: updateMeSchema }), asyncHandler(usersController.updateMe));
