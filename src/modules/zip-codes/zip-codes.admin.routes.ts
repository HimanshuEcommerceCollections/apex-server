import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { validate } from "../../middleware/validate";
import { authorize } from "../../middleware/auth";
import { zipCodesController } from "./zip-codes.controller";
import {
  createZipSchema,
  listZipsQuerySchema,
  updateZipSchema,
  zipIdParamSchema,
} from "./zip-codes.validation";

/** /api/v1/admin/zip-codes — mounted under the admin router (authenticate applied). */
export const adminZipCodesRouter = Router();

adminZipCodesRouter.use(authorize("geo:manage"));

adminZipCodesRouter.get("/", validate({ query: listZipsQuerySchema }), asyncHandler(zipCodesController.list));
adminZipCodesRouter.post("/", validate({ body: createZipSchema }), asyncHandler(zipCodesController.create));
adminZipCodesRouter.patch(
  "/:id",
  validate({ params: zipIdParamSchema, body: updateZipSchema }),
  asyncHandler(zipCodesController.update),
);
adminZipCodesRouter.delete(
  "/:id",
  validate({ params: zipIdParamSchema }),
  asyncHandler(zipCodesController.remove),
);
