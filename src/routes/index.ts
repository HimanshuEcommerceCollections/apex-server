import { Router } from "express";
import { healthRouter } from "../modules/health";
import { waitlistRouter } from "../modules/waitlist";
import { authRouter } from "../modules/auth";
import { meRouter, adminUsersRouter } from "../modules/users";
import { servicesRouter } from "../modules/services";
import { serviceAreaRouter, adminCoverageRouter } from "../modules/service-area";
import { adminAreasRouter } from "../modules/areas";
import { adminZipCodesRouter } from "../modules/zip-codes";
import { bookingsRouter, meBookingsRouter, adminBookingsRouter } from "../modules/bookings";
import { adminQuotesRouter } from "../modules/quotes";
import { pmRequestsRouter } from "../modules/pm-requests";
import { proApplicationsRouter } from "../modules/pro-applications";
import { adminCatalogRouter } from "../modules/catalog";
import { paymentsRouter, adminPaymentsRouter } from "../modules/payments";
import {
  membershipRouter,
  meMembershipsRouter,
  adminMembershipPlansRouter,
} from "../modules/memberships";
import { authenticate } from "../middleware/auth";

/** API v1 router — aggregates every mounted feature module under /api/v1. */
export const apiRouter = Router();

apiRouter.use("/health", healthRouter);
apiRouter.use("/waitlist", waitlistRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/bookings", bookingsRouter);
// /me/* sub-routers are mounted BEFORE /me so they win the prefix match (no double auth).
apiRouter.use("/me/bookings", meBookingsRouter);
apiRouter.use("/me/memberships", meMembershipsRouter);
apiRouter.use("/me", meRouter);
apiRouter.use("/services", servicesRouter);
apiRouter.use("/service-area", serviceAreaRouter);
apiRouter.use("/pm-requests", pmRequestsRouter);
apiRouter.use("/pro-applications", proApplicationsRouter);
apiRouter.use("/payments", paymentsRouter);
apiRouter.use("/membership", membershipRouter);

// Staff/admin surface: authenticate once here, then each route authorizes its
// capability (07 §4). Sub-routers grow as their features land.
const adminRouter = Router();
adminRouter.use(authenticate);
adminRouter.use("/users", adminUsersRouter);
adminRouter.use("/areas", adminAreasRouter);
adminRouter.use("/zip-codes", adminZipCodesRouter);
adminRouter.use("/coverage", adminCoverageRouter);
adminRouter.use("/bookings", adminBookingsRouter);
adminRouter.use("/quotes", adminQuotesRouter);
adminRouter.use("/catalog", adminCatalogRouter);
adminRouter.use("/payments", adminPaymentsRouter);
adminRouter.use("/membership-plans", adminMembershipPlansRouter);
apiRouter.use("/admin", adminRouter);

// Mounted as their modules land (roadmap 07 §11):
//   /membership  /webhooks/stripe (top-level)
//   /admin/catalog  /admin/crews  /admin/payroll
// modules/pricing, modules/demo-inbox are ROUTELESS.
