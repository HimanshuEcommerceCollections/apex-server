import type { Request, Response } from "express";
import { paymentsService } from "./payments.service";
import { sendSuccess } from "../../utils/api-response";

export class PaymentsController {
  // Customer: create a PaymentIntent for their own booking (ownership enforced in the service).
  createIntent = async (req: Request, res: Response) => {
    sendSuccess(res, await paymentsService.createIntentForBooking(req.user!.id, req.params.reference));
  };

  // Admin/coordinator: full or partial refund.
  refund = async (req: Request, res: Response) => {
    const { amount } = req.body as { amount?: number };
    sendSuccess(res, await paymentsService.refund(req.params.id, amount, req.user!.id, req.ip), "Refund issued");
  };
}

export const paymentsController = new PaymentsController();

// Top-level Stripe webhook (raw body; mounted in app.ts before express.json).
export const stripeWebhookHandler = async (req: Request, res: Response) => {
  const sig = req.get("stripe-signature") ?? "";
  const result = await paymentsService.handleWebhook(req.body as Buffer, sig);
  res.status(200).json({ success: true, received: true, ...result });
};
