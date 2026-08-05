import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { validate } from "../../middleware/validate";
import { authorize } from "../../middleware/auth";
import { adminCatalogController } from "./catalog.admin.controller";
import {
  catalogServiceParamSchema,
  createCadenceSchema,
  createGroupSchema,
  createOptionSchema,
  createPlanSchema,
  groupParamSchema,
  idParamSchema,
  patchCadenceSchema,
  patchGroupSchema,
  patchOptionSchema,
  patchPlanSchema,
  putRecurringSchema,
  updatePricingSchema,
} from "./catalog.validation";

/**
 * /api/v1/admin/catalog — the admin pricing editor (catalog:publish).
 *
 * Static segments (cadences, plans) are mounted BEFORE the /services/:idOrSlug
 * subtree so they can never be captured as a service slug.
 */
export const adminCatalogRouter = Router();
adminCatalogRouter.use(authorize("catalog:publish"));

// ── Global cadences ───────────────────────────────────────────────────────────
adminCatalogRouter.get("/cadences", asyncHandler(adminCatalogController.listCadences));
adminCatalogRouter.post(
  "/cadences",
  validate({ body: createCadenceSchema }),
  asyncHandler(adminCatalogController.createCadence),
);
adminCatalogRouter.patch(
  "/cadences/:id",
  validate({ params: idParamSchema, body: patchCadenceSchema }),
  asyncHandler(adminCatalogController.patchCadence),
);

// ── Plans ─────────────────────────────────────────────────────────────────────
adminCatalogRouter.get("/plans", asyncHandler(adminCatalogController.listPlans));
adminCatalogRouter.post(
  "/plans",
  validate({ body: createPlanSchema }),
  asyncHandler(adminCatalogController.createPlan),
);
adminCatalogRouter.patch(
  "/plans/:id",
  validate({ params: idParamSchema, body: patchPlanSchema }),
  asyncHandler(adminCatalogController.patchPlan),
);

// ── Per-service editor ────────────────────────────────────────────────────────
adminCatalogRouter.get(
  "/services/:idOrSlug",
  validate({ params: catalogServiceParamSchema }),
  asyncHandler(adminCatalogController.get),
);
adminCatalogRouter.put(
  "/services/:idOrSlug/pricing",
  validate({ params: catalogServiceParamSchema, body: updatePricingSchema }),
  asyncHandler(adminCatalogController.updatePricing),
);

// Configurations (groups + options).
adminCatalogRouter.post(
  "/services/:idOrSlug/groups",
  validate({ params: catalogServiceParamSchema, body: createGroupSchema }),
  asyncHandler(adminCatalogController.createGroup),
);
adminCatalogRouter.patch(
  "/services/:idOrSlug/groups/:groupId",
  validate({ params: groupParamSchema, body: patchGroupSchema }),
  asyncHandler(adminCatalogController.patchGroup),
);
adminCatalogRouter.post(
  "/services/:idOrSlug/groups/:groupId/options",
  validate({ params: groupParamSchema, body: createOptionSchema }),
  asyncHandler(adminCatalogController.createOption),
);
adminCatalogRouter.patch(
  "/services/:idOrSlug/options/:id",
  validate({ params: catalogServiceParamSchema.extend(idParamSchema.shape), body: patchOptionSchema }),
  asyncHandler(adminCatalogController.patchOption),
);

// Recurring grid (per-service cadence % + isActive).
adminCatalogRouter.put(
  "/services/:idOrSlug/recurring",
  validate({ params: catalogServiceParamSchema, body: putRecurringSchema }),
  asyncHandler(adminCatalogController.putRecurring),
);
