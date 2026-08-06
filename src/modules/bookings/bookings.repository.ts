import { Prisma, BookingSource, BookingStatus, Brand, PricingMode, QuoteSource } from "@prisma/client";
import { prisma } from "../../db/client";
import { BRAND_CODE, PAYMENT_WINDOW_HOURS } from "../../constants";
import { withTxRetry } from "../../utils/tx-retry";
import { nextBookingReference } from "./booking-reference";
import type { BookedCreateInput } from "./bookings.types";

const serviceSelect = { select: { slug: true, name: true } } as const;

export class BookingsRepository {
  /** The whole booked-arm write set — commits or rolls back together. */
  createBooked(input: BookedCreateInput) {
    return withTxRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const reference = await nextBookingReference(tx, BRAND_CODE);
          const isQuote = input.pricingMode === PricingMode.QUOTE;
          return tx.booking.create({
            data: {
              reference,
              clientRequestId: input.clientRequestId ?? null,
              serviceId: input.serviceId,
              customerId: input.customerId,
              // FROM is pay-at-booking: born AWAITING_PAYMENT with an auto-cancel
              // deadline. QUOTE stays PENDING — coordinator-controlled lifecycle.
              status: isQuote ? BookingStatus.PENDING : BookingStatus.AWAITING_PAYMENT,
              paymentDueAt: isQuote ? null : new Date(Date.now() + PAYMENT_WINDOW_HOURS * 3600_000),
              quoteRequest: isQuote,
              brand: Brand.APEX,
              source: BookingSource.WEB,
              contactName: input.contact.name,
              contactEmail: input.contact.email,
              contactPhone: input.contact.phone ?? null,
              contactPreferredMethod: input.contact.preferredMethod,
              consentMarketing: input.contact.consentMarketing,
              addressStreet: input.address.street,
              addressCity: input.address.city,
              addressState: input.address.state,
              addressZip: input.address.zip,
              notes: input.notes ?? null,
              configuration: {
                create: {
                  serviceId: input.serviceId,
                  selections: input.selections as Prisma.InputJsonValue,
                  quantity: input.quantity,
                  description: input.description ?? null,
                  priceTotal: input.priced?.total.amount ?? null,
                  priceSubtotal: input.priced?.subtotal?.amount ?? null,
                  lineItems: (input.priced?.line_items ?? undefined) as Prisma.InputJsonValue | undefined,
                  pricingVersion: input.priced?.pricing_version ?? null,
                  currency: input.priced?.total.currency ?? "USD",
                  isEstimate: true,
                  // Charge snapshot (rate as-of-booking; QUOTE amounts stay null
                  // until the intent computes them from quotedAmount).
                  taxRateBps: input.tax.taxRateBps,
                  taxAmount: input.tax.taxAmount,
                  grandTotal: input.tax.grandTotal,
                },
              },
              ...(isQuote
                ? {
                    quote: {
                      create: {
                        serviceId: input.serviceId,
                        description: input.description ?? "",
                        source: QuoteSource.BOOKING_FLOW,
                        contactName: input.contact.name,
                        contactEmail: input.contact.email,
                        contactPhone: input.contact.phone ?? null,
                      },
                    },
                  }
                : {}),
            },
            include: { configuration: true, quote: true },
          });
        },
        { timeout: 5000 },
      ),
    );
  }

  findByClientRequestId(clientRequestId: string) {
    return prisma.booking.findUnique({ where: { clientRequestId } });
  }

  findManyForCustomer(customerId: string) {
    return prisma.booking.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      include: {
        service: serviceSelect,
        configuration: {
          select: { priceTotal: true, currency: true, taxRateBps: true, taxAmount: true, grandTotal: true },
        },
        quote: { select: { quotedAmount: true } },
      },
    });
  }

  findForCustomerByReference(reference: string, customerId: string) {
    return prisma.booking.findFirst({
      where: { reference, customerId },
      include: { service: serviceSelect, configuration: true, quote: true },
    });
  }

  // --- admin (any customer) ---
  private adminInclude = {
    service: serviceSelect,
    customer: { select: { id: true, name: true, email: true } },
    configuration: { select: { priceTotal: true, currency: true } },
  } as const;

  async listAndCountAll(f: { status?: BookingStatus; search?: string; skip: number; take: number }) {
    const where: Prisma.BookingWhereInput = {};
    if (f.status) where.status = f.status;
    if (f.search) {
      where.OR = [
        { reference: { contains: f.search, mode: "insensitive" } },
        { contactEmail: { contains: f.search, mode: "insensitive" } },
      ];
    }
    const [rows, total] = await Promise.all([
      prisma.booking.findMany({ where, orderBy: { createdAt: "desc" }, skip: f.skip, take: f.take, include: this.adminInclude }),
      prisma.booking.count({ where }),
    ]);
    return { rows, total };
  }

  findByReferenceAdmin(reference: string) {
    return prisma.booking.findUnique({
      where: { reference },
      include: {
        service: serviceSelect,
        customer: { select: { id: true, name: true, email: true } },
        configuration: true,
        quote: true,
      },
    });
  }

  updateByReference(reference: string, data: Prisma.BookingUncheckedUpdateInput) {
    return prisma.booking.update({ where: { reference }, data, include: this.adminInclude });
  }

  /** Status transition by id (used by the payments webhook/refund reconciliation). */
  setStatusById(id: string, status: BookingStatus) {
    return prisma.booking.update({ where: { id }, data: { status } });
  }

  /** Unpaid FROM bookings past their payment deadline (the cron sweep's input). */
  findAbandonedAwaitingPayment(now: Date) {
    return prisma.booking.findMany({
      where: {
        status: BookingStatus.AWAITING_PAYMENT,
        quoteRequest: false,
        paymentDueAt: { lt: now },
      },
      select: { id: true, reference: true },
    });
  }

  /** Auto-created fulfilment visit for a membership cycle (source SUBSCRIPTION). */
  createSubscriptionVisit(input: {
    customerId: string;
    serviceId: string;
    membershipId: string;
    contact: { name: string; email: string; phone: string | null };
    address: { street: string; city: string; state: string; zip: string };
    selections: Prisma.InputJsonValue;
    quantity: number;
    amount: number;
    currency: string;
  }) {
    return withTxRetry(() =>
      prisma.$transaction(async (tx) => {
        const reference = await nextBookingReference(tx, BRAND_CODE);
        return tx.booking.create({
          data: {
            reference,
            serviceId: input.serviceId,
            customerId: input.customerId,
            membershipId: input.membershipId,
            status: BookingStatus.PAID, // paid by the membership invoice that created it
            source: BookingSource.SUBSCRIPTION,
            contactName: input.contact.name,
            contactEmail: input.contact.email,
            contactPhone: input.contact.phone,
            addressStreet: input.address.street,
            addressCity: input.address.city,
            addressState: input.address.state,
            addressZip: input.address.zip,
            configuration: {
              create: {
                serviceId: input.serviceId,
                selections: input.selections,
                quantity: input.quantity,
                priceTotal: input.amount,
                priceSubtotal: input.amount,
                pricingVersion: null,
                currency: input.currency,
                isEstimate: false,
              },
            },
          },
        });
      }),
    );
  }
}

export const bookingsRepository = new BookingsRepository();
