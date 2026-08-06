import { Prisma } from "@prisma/client";
import { ContactMethod, FormKind, ServiceStatus, WaitlistSource } from "../../enums";
import { ApiError } from "../../utils/api-error";
import { buildMeta, buildPagination } from "../../utils/pagination";
import type { PaginationMeta } from "../../utils/api-response";
import { validateSelections, type ConfigInput, type GroupDescriptor, type PricingModeName } from "../../shared";
import { servicesRepository } from "../services";
import { serviceConfigRepository } from "../services/config/service-config.repository";
import { availabilityService } from "../service-area";
import { pricingService, type DisplayedPrice } from "../pricing";
import { waitlistService } from "../waitlist";
import { demoInboxService } from "../demo-inbox";
import { bookingsRepository } from "./bookings.repository";
import type {
  AdminBookingSummary,
  BookingSubmitResult,
  CreateBookingDto,
  MyBookingSummary,
} from "./bookings.types";

type BookingRow = { reference: string; id: string; status: string };

export class BookingsService {
  /** POST /bookings — the Core Flow. Returns the BOOKED or WAITLISTED union arm. */
  async submit(customerId: string, dto: CreateBookingDto): Promise<BookingSubmitResult> {
    const service = await servicesRepository.findByIdOrSlug(dto.service_type);
    if (!service) throw ApiError.notFound("Service not found", { code: "SERVICE_NOT_FOUND" });
    if (service.status !== ServiceStatus.ACTIVE) {
      throw ApiError.badRequest("This service is not currently bookable", { code: "SERVICE_NOT_BOOKABLE" });
    }

    // Idempotent replay (double-submit / post-commit retry).
    if (dto.request_id) {
      const existing = await bookingsRepository.findByClientRequestId(dto.request_id);
      if (existing) return this.booked(existing, null);
    }

    // Selection validation (strict — booking submit).
    const cfg = await serviceConfigRepository.findServiceWithConfig(dto.service_type);
    const groups: GroupDescriptor[] = (cfg?.configGroups ?? []).map((g) => ({
      key: g.key,
      inputType: g.inputType as ConfigInput,
      isRequired: g.isRequired,
      selectMin: g.selectMin,
      selectMax: g.selectMax,
      quantityMin: g.quantityMin,
      quantityMax: g.quantityMax,
      optionKeys: g.options.map((o) => o.key),
    }));
    const violations = validateSelections({
      selections: dto.configuration.selections,
      groups,
      pricingMode: service.pricingMode as PricingModeName,
      description: dto.configuration.description,
      strict: true,
    });
    if (violations.length) {
      throw ApiError.unprocessable("Invalid selections", { code: violations[0].code, violations });
    }

    // Zip gate (per-service availability — grant + override).
    const avail = await availabilityService.isServiceAvailable(service.id, dto.address.zip);
    if (!avail.eligible) {
      const { signup } = await waitlistService.signup({
        email: dto.contact.email,
        zip: dto.address.zip,
        source: WaitlistSource.SERVICE_AREA_MISS,
      });
      await demoInboxService.record(FormKind.WAITLIST, signup.signup_id, {
        email: dto.contact.email,
        zip: dto.address.zip,
        service_type: dto.service_type,
        reason: avail.reason,
      });
      return { outcome: "WAITLISTED", waitlist_signup: signup };
    }

    // Authoritative recompute (throws PRICE_MISMATCH / QUOTE_DESCRIPTION_REQUIRED).
    const clientPrice: DisplayedPrice | null = dto.displayed_price
      ? {
          total: dto.displayed_price.total,
          subtotal: dto.displayed_price.subtotal,
          line_items: [],
          pricing_version: dto.displayed_price.pricing_version ?? "",
          is_estimate: true,
        }
      : null;
    const priced = await pricingService.recomputeForBooking(
      dto.service_type,
      {
        selections: dto.configuration.selections,
        quantity: dto.configuration.quantity,
        description: dto.configuration.description,
      },
      clientPrice,
    );

    // Charge snapshot: the tax rate is captured AS-OF-BOOKING (catalog edits
    // never move an existing booking); for FROM the payable grand total is
    // fixed here too. QUOTE gets its taxAmount/grandTotal at intent time from
    // quotedAmount × this stored rate.
    const taxRateBps = service.taxRateBps;
    const taxAmount = priced ? Math.round((priced.total.amount * taxRateBps) / 10000) : null;
    const grandTotal = priced ? priced.total.amount + taxAmount! : null;

    // Transactional persistence.
    try {
      const booking = await bookingsRepository.createBooked({
        customerId,
        serviceId: service.id,
        pricingMode: service.pricingMode,
        clientRequestId: dto.request_id ?? null,
        contact: {
          name: dto.contact.name,
          email: dto.contact.email,
          phone: dto.contact.phone ?? null,
          preferredMethod: (dto.contact.preferred_method ?? "EMAIL") as ContactMethod,
          consentMarketing: dto.contact.consent_marketing ?? false,
        },
        address: dto.address,
        selections: dto.configuration.selections,
        quantity: dto.configuration.quantity ?? 1,
        description: dto.configuration.description ?? null,
        priced,
        tax: { taxRateBps, taxAmount, grandTotal },
        notes: dto.notes ?? null,
      });

      await demoInboxService.record(FormKind.BOOKING, booking.id, {
        service_type: dto.service_type,
        contact: dto.contact,
        address: dto.address,
      });
      return this.booked(booking, priced);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002" &&
        dto.request_id
      ) {
        const existing = await bookingsRepository.findByClientRequestId(dto.request_id);
        if (existing) return this.booked(existing, null);
      }
      throw err;
    }
  }

  async listMine(customerId: string): Promise<MyBookingSummary[]> {
    const rows = await bookingsRepository.findManyForCustomer(customerId);
    return rows.map((b) => {
      const cfg = b.configuration;
      const quotedAmount = b.quote?.quotedAmount ?? null;
      // QUOTE amounts derive from the coordinator's number × the STORED rate.
      const taxAmount =
        cfg?.taxAmount ??
        (quotedAmount != null ? Math.round((quotedAmount * (cfg?.taxRateBps ?? 0)) / 10000) : null);
      const grandTotal = cfg?.grandTotal ?? (quotedAmount != null ? quotedAmount + (taxAmount ?? 0) : null);
      const canPay = b.quoteRequest
        ? quotedAmount != null && (b.status === "PENDING" || b.status === "AWAITING_PAYMENT")
        : b.status === "AWAITING_PAYMENT";
      return {
        reference: b.reference,
        service: b.service ? { slug: b.service.slug, name: b.service.name } : null,
        status: b.status,
        quoteRequest: b.quoteRequest,
        priceTotal: cfg?.priceTotal ?? quotedAmount,
        taxAmount,
        grandTotal,
        quotedAmount,
        currency: cfg?.currency ?? "USD",
        canPay,
        // Customer cancel is for unpaid FROM bookings only; QUOTE is coordinator-controlled.
        canCancel: !b.quoteRequest && b.status === "AWAITING_PAYMENT",
        paymentDueAt: b.paymentDueAt ? b.paymentDueAt.toISOString() : null,
        scheduledAt: b.scheduledAt ? b.scheduledAt.toISOString() : null,
        createdAt: b.createdAt.toISOString(),
      };
    });
  }

  /** Customer-initiated cancel: unpaid FROM bookings only; also voids any open PaymentIntent. */
  async cancelMine(customerId: string, reference: string): Promise<{ canceled: boolean }> {
    const b = await bookingsRepository.findForCustomerByReference(reference, customerId);
    if (!b) throw ApiError.notFound("Booking not found", { code: "BOOKING_NOT_FOUND" });
    if (b.quoteRequest) {
      throw ApiError.badRequest("Quote bookings are managed by your coordinator", { code: "QUOTE_NOT_CANCELABLE" });
    }
    if (b.status !== "AWAITING_PAYMENT") {
      throw ApiError.badRequest("Only unpaid bookings can be cancelled", { code: "BOOKING_NOT_CANCELABLE" });
    }
    const { paymentsService } = await import("../payments");
    await paymentsService.voidOpenIntents(b.id);
    await bookingsRepository.setStatusById(b.id, "CANCELLED" as never);
    return { canceled: true };
  }

  async getMine(customerId: string, reference: string) {
    const b = await bookingsRepository.findForCustomerByReference(reference, customerId);
    if (!b) throw ApiError.notFound("Booking not found", { code: "BOOKING_NOT_FOUND" });
    return {
      reference: b.reference,
      status: b.status,
      service: b.service ? { slug: b.service.slug, name: b.service.name } : null,
      quoteRequest: b.quoteRequest,
      configuration: b.configuration && {
        selections: b.configuration.selections,
        quantity: b.configuration.quantity,
        description: b.configuration.description,
        priceTotal: b.configuration.priceTotal,
        lineItems: b.configuration.lineItems,
        currency: b.configuration.currency,
      },
      address: {
        street: b.addressStreet,
        city: b.addressCity,
        state: b.addressState,
        zip: b.addressZip,
      },
      scheduledAt: b.scheduledAt ? b.scheduledAt.toISOString() : null,
      createdAt: b.createdAt.toISOString(),
    };
  }

  // --- admin (coordinator/admin) ---

  async adminList(q: {
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<{ bookings: AdminBookingSummary[]; meta: PaginationMeta }> {
    const { page, limit, skip } = buildPagination(q);
    const { rows, total } = await bookingsRepository.listAndCountAll({
      status: q.status as never,
      search: q.search,
      skip,
      take: limit,
    });
    return { bookings: rows.map((b) => this.adminSummary(b)), meta: buildMeta(page, limit, total) };
  }

  async adminGet(reference: string) {
    const b = await bookingsRepository.findByReferenceAdmin(reference);
    if (!b) throw ApiError.notFound("Booking not found", { code: "BOOKING_NOT_FOUND" });
    return {
      ...this.adminSummary(b),
      configuration: b.configuration && {
        selections: b.configuration.selections,
        quantity: b.configuration.quantity,
        description: b.configuration.description,
        priceTotal: b.configuration.priceTotal,
        lineItems: b.configuration.lineItems,
        currency: b.configuration.currency,
      },
      quotedAmount: b.quote?.quotedAmount ?? null,
      address: { street: b.addressStreet, city: b.addressCity, state: b.addressState, zip: b.addressZip },
      contact: { name: b.contactName, email: b.contactEmail, phone: b.contactPhone },
      notes: b.notes,
    };
  }

  async adminTransition(
    reference: string,
    changes: { status?: string; scheduledAt?: Date },
  ): Promise<AdminBookingSummary> {
    const existing = await bookingsRepository.findByReferenceAdmin(reference);
    if (!existing) throw ApiError.notFound("Booking not found", { code: "BOOKING_NOT_FOUND" });
    const updated = await bookingsRepository.updateByReference(reference, {
      ...(changes.status ? { status: changes.status as never } : {}),
      ...(changes.scheduledAt ? { scheduledAt: changes.scheduledAt } : {}),
    });
    return this.adminSummary(updated);
  }

  private adminSummary(b: {
    reference: string;
    status: string;
    scheduledAt: Date | null;
    createdAt: Date;
    contactEmail: string;
    quoteRequest: boolean;
    service: { slug: string; name: string } | null;
    customer: { id: string; name: string; email: string } | null;
    configuration: { priceTotal: number | null; currency: string } | null;
  }): AdminBookingSummary {
    return {
      reference: b.reference,
      status: b.status,
      service: b.service ? { slug: b.service.slug, name: b.service.name } : null,
      priceTotal: b.configuration?.priceTotal ?? null,
      currency: b.configuration?.currency ?? "USD",
      scheduledAt: b.scheduledAt ? b.scheduledAt.toISOString() : null,
      createdAt: b.createdAt.toISOString(),
      customer: b.customer ? { id: b.customer.id, name: b.customer.name, email: b.customer.email } : null,
      contactEmail: b.contactEmail,
      quoteRequest: b.quoteRequest,
    };
  }

  private booked(b: BookingRow, priced: DisplayedPrice | null): BookingSubmitResult {
    return {
      outcome: "BOOKED",
      reference: b.reference,
      booking_id: b.id,
      status: b.status,
      displayed_price: priced,
      next: "coordinator_confirms",
    };
  }
}

export const bookingsService = new BookingsService();
