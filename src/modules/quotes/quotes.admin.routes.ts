import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { validate } from "../../middleware/validate";
import { authorize } from "../../middleware/auth";
import { adminQuotesController } from "./quotes.admin.controller";
import { listQuotesQuerySchema, quoteIdParamSchema, updateQuoteSchema } from "./quotes.validation";

/** /api/v1/admin/quotes — mounted under the admin router (authenticate applied). */
export const adminQuotesRouter = Router();

adminQuotesRouter.get(
  "/",
  authorize("quote:read"),
  validate({ query: listQuotesQuerySchema }),
  asyncHandler(adminQuotesController.list),
);
adminQuotesRouter.patch(
  "/:id",
  authorize("quote:manage"),
  validate({ params: quoteIdParamSchema, body: updateQuoteSchema }),
  asyncHandler(adminQuotesController.update),
);
