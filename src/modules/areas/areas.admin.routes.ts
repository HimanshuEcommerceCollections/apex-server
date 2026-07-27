import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { validate } from "../../middleware/validate";
import { authorize } from "../../middleware/auth";
import { areasController } from "./areas.controller";
import {
  areaIdParamSchema,
  createAreaSchema,
  listAreasQuerySchema,
  updateAreaSchema,
} from "./areas.validation";

/** /api/v1/admin/areas — mounted under the admin router (authenticate applied). */
export const adminAreasRouter = Router();

adminAreasRouter.use(authorize("geo:manage"));

adminAreasRouter.get("/", validate({ query: listAreasQuerySchema }), asyncHandler(areasController.list));
adminAreasRouter.post("/", validate({ body: createAreaSchema }), asyncHandler(areasController.create));
adminAreasRouter.patch(
  "/:id",
  validate({ params: areaIdParamSchema, body: updateAreaSchema }),
  asyncHandler(areasController.update),
);
adminAreasRouter.delete("/:id", validate({ params: areaIdParamSchema }), asyncHandler(areasController.remove));
adminAreasRouter.post(
  "/:id/restore",
  validate({ params: areaIdParamSchema }),
  asyncHandler(areasController.restore),
);
