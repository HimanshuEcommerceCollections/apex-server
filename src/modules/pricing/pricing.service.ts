import { CadenceInterval, ServiceStatus } from "../../enums";
import { ONE_TIME_CADENCE_KEY } from "../../constants";
import { ApiError } from "../../utils/api-error";
import type { DisplayedPrice } from "./engine/types";
import { buildPricingTable } from "./build-pricing-table";
import { getPricingModeHandler } from "./modes/registry";
import type { PricingCadence } from "./modes/handler.types";
import type { PricePreview, PricePreviewInput, PricingModeContext } from "./pricing.types";
import { pricingRepository } from "./pricing.repository";

/** The fully-included Service row the pricing pipeline works from. */
type ServiceForPricing = NonNullable<Awaited<ReturnType<typeof pricingRepository.findServiceForPricing>>>;

/**
 * Compare the server-recomputed price against the client-sent displayed_price.
 * The recompute is ALWAYS authoritative; the client value is a cross-check,
 * never an input. Mismatch -> 422, never silently accepted, never clamped.
 */
export function assertPriceIntegrity(
  recomputed: DisplayedPrice | null,
  clientPrice: DisplayedPrice | null,
): void {
  if (!clientPrice) return; // client price optional; recompute stands alone

  if (!recomputed) {
    throw ApiError.unprocessable("Quote services do not carry a price", {
      code: "QUOTE_PRICE_NOT_ALLOWED",
    });
  }

  const matches =
    recomputed.total.amount === clientPrice.total.amount &&
    recomputed.total.currency === clientPrice.total.currency;

  if (!matches) {
    throw ApiError.unprocessable("Price mismatch", {
      code: "PRICE_MISMATCH",
      client_total: clientPrice.total.amount,
      server_total: recomputed.total.amount,
      pricing_version: recomputed.pricing_version,
      displayed_price: recomputed,
    });
  }
}

class PricingService {
  /** Step-3 live preview — POST /services/:idOrSlug/config/price. */
  async preview(idOrSlug: string, input: PricePreviewInput): Promise<PricePreview> {
    const ctx = await this.buildContext(idOrSlug, input);
    return getPricingModeHandler(ctx.service.pricingMode).preview(ctx);
  }

  /**
   * Authoritative recompute inside POST /bookings. Returns the DisplayedPrice
   * the booking snapshots — null for QUOTE (which keeps priceTotal NULL and
   * demands configuration.description). Read-only: runs BEFORE the transaction.
   */
  async recomputeForBooking(
    idOrSlug: string,
    input: PricePreviewInput,
    clientPrice: DisplayedPrice | null,
  ): Promise<{ price: DisplayedPrice | null; cadence: PricingCadence }> {
    const ctx = await this.buildContext(idOrSlug, input);
    const recomputed = getPricingModeHandler(ctx.service.pricingMode).recompute(ctx);
    assertPriceIntegrity(recomputed, clientPrice);
    // The cadence comes back too: it decides whether the caller books-and-charges
    // or starts a subscription, and its % is snapshotted onto whichever it makes.
    return { price: recomputed, cadence: ctx.cadence };
  }

  /**
   * Best-effort INDICATIVE engine total for a stored configuration — the number a
   * coordinator sees next to a quote request as a starting point. Never binding,
   * never charged, and never throws: any failure (service missing, inactive,
   * malformed selections) is null, because an unpriceable quote is still a
   * perfectly workable quote.
   */
  async indicativeFor(
    idOrSlug: string,
    selections: PricePreviewInput["selections"],
    quantity = 1,
  ): Promise<DisplayedPrice | null> {
    try {
      const ctx = await this.buildContext(idOrSlug, { selections, quantity });
      return getPricingModeHandler(ctx.service.pricingMode).preview(ctx).displayed_price;
    } catch {
      return null;
    }
  }

  // recomputeForMembership is gone: a plan's price is BINDING, so membership
  // cycles invoice exactly ServicePlan.price (memberships.service invoice.created).

  private async buildContext(
    idOrSlug: string,
    input: PricePreviewInput,
  ): Promise<PricingModeContext> {
    const service = await pricingRepository.findServiceForPricing(idOrSlug);
    if (!service) {
      throw ApiError.notFound("Service not found", { code: "SERVICE_NOT_FOUND", idOrSlug });
    }
    if (service.status !== ServiceStatus.ACTIVE) {
      throw ApiError.badRequest("This service is not currently bookable", {
        code: "SERVICE_NOT_BOOKABLE",
        status: service.status,
      });
    }
    return {
      service: {
        id: service.id,
        slug: service.slug,
        pricingRef: service.pricingRef,
        pricingMode: service.pricingMode,
        basePrice: service.basePrice,
        currency: service.currency,
      },
      table: buildPricingTable(service),
      configuration: {
        service_id: service.pricingRef,
        selections: input.selections ?? {},
        quantity: input.quantity ?? 1,
        description: input.description,
      },
      cadence: await this.resolveCadence(service.recurring, input.cadenceId),
    };
  }

  /**
   * Resolve the requested payment frequency against the service's Recurring
   * grid.
   *
   * One-time is always available, whether or not the admin listed it in the
   * grid — it is the floor, not an offer. Any OTHER frequency must be actively
   * offered by this service; an unknown or unoffered one is REJECTED rather
   * than quietly downgraded to one-time, because silently charging full price
   * for a frequency the customer chose is a worse failure than a 400.
   */
  private async resolveCadence(
    offered: ServiceForPricing["recurring"],
    cadenceId?: string,
  ): Promise<PricingCadence> {
    const oneTime = await this.oneTimeCadence();
    if (!cadenceId || cadenceId === oneTime.cadenceId) {
      // Honour an explicit one-time discount if the admin configured one.
      const row = offered.find((r) => r.cadenceId === oneTime.cadenceId);
      return row ? { ...oneTime, discountPercent: row.discountPercent } : oneTime;
    }

    const row = offered.find((r) => r.cadenceId === cadenceId);
    if (!row) {
      throw ApiError.badRequest("This service does not offer that payment frequency", {
        code: "CADENCE_NOT_OFFERED",
        cadenceId,
      });
    }
    return {
      cadenceId: row.cadenceId,
      key: row.cadence.key,
      label: row.cadence.label,
      discountPercent: row.discountPercent,
      isSubscription: row.cadence.interval !== CadenceInterval.NONE,
    };
  }

  /** Memoised: the system one-time row is immutable for the process's life. */
  private oneTime: PricingCadence | null = null;
  private async oneTimeCadence(): Promise<PricingCadence> {
    if (this.oneTime) return this.oneTime;
    const row = await pricingRepository.findOneTimeCadence();
    if (!row) {
      throw new Error(
        `The system "${ONE_TIME_CADENCE_KEY}" cadence is missing — every booking depends on it.`,
      );
    }
    this.oneTime = {
      cadenceId: row.id,
      key: row.key,
      label: row.label,
      discountPercent: 0,
      isSubscription: false,
    };
    return this.oneTime;
  }
}

export const pricingService = new PricingService();
