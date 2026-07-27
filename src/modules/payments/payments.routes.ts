import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { validate } from "../../middleware/validate";
import { authenticate, authorize } from "../../middleware/auth";
import { paymentsController } from "./payments.controller";
import { intentParamSchema, paymentIdParamSchema, refundBodySchema } from "./payments.validation";

/** /api/v1/payments — authenticated customer payment actions. */
export const paymentsRouter = Router();
paymentsRouter.use(authenticate);
paymentsRouter.post(
  "/booking/:reference/intent",
  validate({ params: intentParamSchema }),
  asyncHandler(paymentsController.createIntent),
);

/** /api/v1/admin/payments — refunds (payment:refund; mounted under the admin router). */
export const adminPaymentsRouter = Router();
adminPaymentsRouter.post(
  "/:id/refund",
  authorize("payment:refund"),
  validate({ params: paymentIdParamSchema, body: refundBodySchema }),
  asyncHandler(paymentsController.refund),
);
