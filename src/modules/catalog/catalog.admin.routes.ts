import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { validate } from "../../middleware/validate";
import { authorize } from "../../middleware/auth";
import { adminCatalogController } from "./catalog.admin.controller";
import { catalogServiceParamSchema, updatePricingSchema } from "./catalog.validation";

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
