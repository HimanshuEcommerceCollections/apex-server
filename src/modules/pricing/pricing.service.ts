import { ServiceStatus } from "../../enums";
import { ApiError } from "../../utils/api-error";
import type { DisplayedPrice } from "./engine/types";
import { buildPricingTable } from "./build-pricing-table";
import { getPricingModeHandler } from "./modes/registry";
import type { PricePreview, PricePreviewInput, PricingModeContext } from "./pricing.types";
import { pricingRepository } from "./pricing.repository";

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
  ): Promise<DisplayedPrice | null> {
    const ctx = await this.buildContext(idOrSlug, input);
    const recomputed = getPricingModeHandler(ctx.service.pricingMode).recompute(ctx);
    assertPriceIntegrity(recomputed, clientPrice);
    return recomputed;
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

  /**
   * Recompute a membership cycle's price from the member's stored configuration
   * against the latest published catalog (docs 07 §6.4). Used by the invoice.created
   * webhook to set each cycle's amount. Throws for non-billable (QUOTE) services.
   */
  async recomputeForMembership(
    idOrSlug: string,
    selections: PricePreviewInput["selections"],
    quantity = 1,
  ): Promise<{ amount: number; currency: string }> {
    const ctx = await this.buildContext(idOrSlug, { selections, quantity });
    const dp = getPricingModeHandler(ctx.service.pricingMode).recompute(ctx);
    if (!dp) {
      throw ApiError.badRequest("This service can't be billed as a membership", {
        code: "NOT_MEMBERSHIP_BILLABLE",
      });
    }
    return { amount: dp.total.amount, currency: dp.total.currency };
  }

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
        fromPrice: service.fromPrice,
        currency: service.currency,
      },
      table: buildPricingTable(service),
      configuration: {
        service_id: service.pricingRef,
        selections: input.selections ?? {},
        quantity: input.quantity ?? 1,
        description: input.description,
      },
    };
  }
}

export const pricingService = new PricingService();
