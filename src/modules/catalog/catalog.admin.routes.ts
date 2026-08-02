import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { validate } from "../../middleware/validate";
import { authorize } from "../../middleware/auth";
import { adminCatalogController } from "./catalog.admin.controller";
import { catalogServiceParamSchema, replaceRecurringSchema, updatePricingSchema } from "./catalog.validation";

/** /api/v1/admin/catalog — admin-only pricing editor (catalog:publish). */
export const adminCatalogRouter = Router();

adminCatalogRouter.get(
  "/services/:idOrSlug",
  authorize("catalog:publish"),
  validate({ params: catalogServiceParamSchema }),
  asyncHandler(adminCatalogController.get),
);
adminCatalogRouter.put(
  "/services/:idOrSlug/pricing",
  authorize("catalog:publish"),
  validate({ params: catalogServiceParamSchema, body: updatePricingSchema }),
  asyncHandler(adminCatalogController.updatePricing),
);

// Service-page "Recurring plans" cards — read + replace-all editor.
adminCatalogRouter.get(
  "/services/:idOrSlug/recurring",
  authorize("catalog:publish"),
  validate({ params: catalogServiceParamSchema }),
  asyncHandler(adminCatalogController.getRecurring),
);
adminCatalogRouter.put(
  "/services/:idOrSlug/recurring",
  authorize("catalog:publish"),
  validate({ params: catalogServiceParamSchema, body: replaceRecurringSchema }),
  asyncHandler(adminCatalogController.putRecurring),
);
