import type Stripe from "stripe";
import { BookingStatus } from "../../enums";
import { env } from "../../config/env";
import { ApiError } from "../../utils/api-error";
import { logger } from "../../utils/logger";
import { randomToken } from "../../utils/tokens";
import { bookingsRepository } from "../bookings";
import { auditService } from "../audit";
import { membershipsService } from "../memberships";
import { paymentsRepository, PaymentStatus, StripeEventStatus } from "./payments.repository";
import { brandMetadata, getStripe, idemKey, isApexObject, webhookSecret } from "./stripe.client";
import type { PaymentIntentResult, RefundResult, WebhookResult } from "./payments.types";

export class PaymentsService {
  /** Create/refresh a PaymentIntent for a booking; amount is the immutable snapshot / quoted price. */
  async createIntentForBooking(userId: string, reference: string): Promise<PaymentIntentResult> {
    const booking = await bookingsRepository.findForCustomerByReference(reference, userId);
    if (!booking) throw ApiError.notFound("Booking not found", { code: "BOOKING_NOT_FOUND" });

    // FROM charges the recompute snapshot; QUOTE charges the coordinator's quotedAmount.
    const amount = booking.configuration?.priceTotal ?? booking.quote?.quotedAmount ?? null;
    if (amount == null) {
      throw ApiError.badRequest("This booking isn't priced yet", { code: "BOOKING_NOT_PRICED" });
    }
    const currency = booking.configuration?.currency ?? "USD";

    const stripe = getStripe();
    const idempotencyKey = idemKey(randomToken(16));
    const payment = await paymentsRepository.create({
      bookingId: booking.id,
      userId,
      amount,
      currency,
      status: PaymentStatus.REQUIRES_PAYMENT,
      idempotencyKey,
    });

    const pi = await stripe.paymentIntents.create(
      {
        amount,
        currency: currency.toLowerCase(),
        automatic_payment_methods: { enabled: true },
        metadata: { ...brandMetadata(), paymentId: payment.id, bookingReference: booking.reference },
        statement_descriptor_suffix: "APEX",
      },
      { idempotencyKey },
    );

    await paymentsRepository.update(payment.id, {
      stripePaymentIntentId: pi.id,
      status: PaymentStatus.PROCESSING,
    });
    await bookingsRepository.setStatusById(booking.id, BookingStatus.AWAITING_PAYMENT);

    return {
      payment_id: payment.id,
      payment_intent_id: pi.id,
      client_secret: pi.client_secret,
      amount,
      currency,
      publishable_key: env.STRIPE_PUBLISHABLE_KEY ?? null,
    };
  }

  /**
   * Verify + process a Stripe webhook. Brand-gated (shared account), completion-
   * gated dedupe, amount-equality backstop. Throws 400 on bad signature; returns
   * {handled:false} for non-Apex/untracked events (caller still acks 200).
   */
  async handleWebhook(rawBody: Buffer, signature: string): Promise<WebhookResult> {
    const stripe = getStripe();
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret());
    } catch {
      throw ApiError.badRequest("Invalid webhook signature", { code: "INVALID_WEBHOOK_SIGNATURE" });
    }

    // Brand gate: reject events explicitly tagged for another brand; APEX-tagged
    // or metadata-less (e.g. charge.*) events proceed and are gated by DB lookup.
    const obj = event.data.object as { metadata?: Stripe.Metadata | null };
    if (obj.metadata?.brand && !isApexObject(obj.metadata)) {
      return { handled: false, reason: "other-brand" };
    }

    const existing = await paymentsRepository.findEvent(event.id);
    if (existing?.status === StripeEventStatus.PROCESSED) return { handled: true, reason: "duplicate" };
    await paymentsRepository.receiveEvent(event.id, event.type);

    try {
      await this.process(event);
      await paymentsRepository.markEvent(event.id, StripeEventStatus.PROCESSED);
    } catch (err) {
      await paymentsRepository.markEvent(event.id, StripeEventStatus.FAILED, String(err));
      throw err; // 500 -> Stripe retries; dedupe only skips PROCESSED
    }
    return { handled: true };
  }

  /** Coordinator/admin refund (full or partial), brand-guarded + idempotent + audited. */
  async refund(
    paymentId: string,
    amount: number | undefined,
    actorUserId: string,
    ip?: string,
  ): Promise<RefundResult> {
    const payment = await paymentsRepository.findById(paymentId);
    if (!payment) throw ApiError.notFound("Payment not found", { code: "PAYMENT_NOT_FOUND" });
    if (!payment.stripePaymentIntentId) {
      throw ApiError.badRequest("Payment has no charge to refund", { code: "NOT_CHARGEABLE" });
    }

    const stripe = getStripe();
    // Belt-and-braces brand guard: never refund a non-Apex charge on the shared account.
    const pi = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);
    if (!isApexObject(pi.metadata)) {
      throw ApiError.forbidden("Refund blocked: not an Apex charge", { code: "BRAND_MISMATCH" });
    }

    const remaining = payment.amount - payment.refundedAmount;
    const refundAmount = amount ?? remaining;
    if (refundAmount <= 0 || refundAmount > remaining) {
      throw ApiError.unprocessable("Invalid refund amount", { code: "REFUND_AMOUNT_INVALID", remaining });
    }

    await stripe.refunds.create(
      { payment_intent: payment.stripePaymentIntentId, amount: refundAmount },
      { idempotencyKey: idemKey(`refund_${paymentId}_${payment.refundedAmount + refundAmount}`) },
    );

    const newRefunded = payment.refundedAmount + refundAmount;
    const status = newRefunded >= payment.amount ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED;
    await paymentsRepository.update(paymentId, { refundedAmount: newRefunded, status });
    if (status === PaymentStatus.REFUNDED && payment.bookingId) {
      await bookingsRepository.setStatusById(payment.bookingId, BookingStatus.CANCELLED);
    }
    await auditService.record({
      actorUserId,
      action: "payment.refund",
      entityType: "Payment",
      entityId: paymentId,
      before: { refundedAmount: payment.refundedAmount, status: payment.status },
      after: { refundedAmount: newRefunded, status },
      ip: ip ?? null,
    });

    return { payment_id: paymentId, refunded_amount: newRefunded, status };
  }

  private async process(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        const payment = await this.resolvePayment(pi);
        if (!payment) return;
        if (pi.amount !== payment.amount) {
          logger.error(`payment amount mismatch: pi=${pi.id} pi.amount=${pi.amount} payment=${payment.amount}`);
          return; // never mark PAID on a tampered/mismatched amount
        }
        await paymentsRepository.update(payment.id, {
          status: PaymentStatus.SUCCEEDED,
          stripeChargeId: typeof pi.latest_charge === "string" ? pi.latest_charge : null,
        });
        if (payment.bookingId) await bookingsRepository.setStatusById(payment.bookingId, BookingStatus.PAID);
        break;
      }
      case "payment_intent.payment_failed": {
        const payment = await this.resolvePayment(event.data.object as Stripe.PaymentIntent);
        if (payment) await paymentsRepository.update(payment.id, { status: PaymentStatus.FAILED });
        break;
      }
      case "payment_intent.canceled": {
        const payment = await this.resolvePayment(event.data.object as Stripe.PaymentIntent);
        if (payment) await paymentsRepository.update(payment.id, { status: PaymentStatus.CANCELED });
        break;
      }
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
        if (!piId) return;
        const payment = await paymentsRepository.findByPaymentIntent(piId);
        if (!payment) return;
        const refunded = charge.amount_refunded;
        const status = refunded >= payment.amount ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED;
        await paymentsRepository.update(payment.id, { refundedAmount: refunded, status });
        if (status === PaymentStatus.REFUNDED && payment.bookingId) {
          await bookingsRepository.setStatusById(payment.bookingId, BookingStatus.CANCELLED);
        }
        break;
      }
      default:
        // Subscription/invoice/checkout events belong to the memberships lifecycle.
        if (
          event.type.startsWith("customer.subscription.") ||
          event.type.startsWith("invoice.") ||
          event.type === "checkout.session.completed"
        ) {
          await membershipsService.handleSubscriptionEvent(event);
        }
        break;
    }
  }

  private async resolvePayment(pi: Stripe.PaymentIntent) {
    const paymentId = pi.metadata?.paymentId;
    if (paymentId) {
      const byId = await paymentsRepository.findById(paymentId);
      if (byId) return byId;
    }
    return paymentsRepository.findByPaymentIntent(pi.id);
  }
}

export const paymentsService = new PaymentsService();
