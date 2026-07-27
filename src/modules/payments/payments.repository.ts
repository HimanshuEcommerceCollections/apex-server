import { Prisma, PaymentStatus, StripeEventStatus } from "@prisma/client";
import { prisma } from "../../db/client";

/** Sole writer of Payment + StripeEvent (one-model-one-writer). */
export class PaymentsRepository {
  create(data: Prisma.PaymentUncheckedCreateInput) {
    return prisma.payment.create({ data });
  }
  findById(id: string) {
    return prisma.payment.findUnique({ where: { id } });
  }
  findByPaymentIntent(stripePaymentIntentId: string) {
    return prisma.payment.findUnique({ where: { stripePaymentIntentId } });
  }
  update(id: string, data: Prisma.PaymentUncheckedUpdateInput) {
    return prisma.payment.update({ where: { id }, data });
  }

  // --- StripeEvent (completion-gated dedupe) ---
  findEvent(id: string) {
    return prisma.stripeEvent.findUnique({ where: { id } });
  }
  receiveEvent(id: string, type: string) {
    return prisma.stripeEvent.upsert({
      where: { id },
      create: { id, type, status: StripeEventStatus.RECEIVED },
      update: {},
    });
  }
  markEvent(id: string, status: StripeEventStatus, error?: string) {
    return prisma.stripeEvent.update({
      where: { id },
      data: {
        status,
        processedAt: status === StripeEventStatus.PROCESSED ? new Date() : undefined,
        error: error ?? null,
      },
    });
  }
}

export const paymentsRepository = new PaymentsRepository();
export { PaymentStatus, StripeEventStatus };
