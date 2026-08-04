import { PricingMode } from "../../../enums";
import { ApiError } from "../../../utils/api-error";
import { computePrice } from "../engine/compute-price";
import type { PricePreview, PricingModeContext, PricingModeHandler } from "./handler.types";

const MIN_DESCRIPTION_LENGTH = 10;

/**
 * QUOTE — coordinator-priced. The engine still runs for the PREVIEW so the
 * customer sees an INDICATIVE base + add-ons figure while configuring, but that
 * number is never binding and never charged: recompute() returns null, so the
 * booking's priceTotal stays NULL and the only chargeable amount is the
 * coordinator's QuoteRequest.quotedAmount (payments.service falls back to it).
 */
class QuoteHandler implements PricingModeHandler {
  readonly mode = PricingMode.QUOTE;

  preview = (ctx: PricingModeContext): PricePreview => ({
    mode: this.mode,
    // Indicative only — requires_pro_confirmation below is what tells the client
    // this number is not a price.
    displayed_price: computePrice(ctx.table, ctx.configuration),
    from_price: null,
    is_from_band: false,
    requires_description: true,
    requires_pro_confirmation: true,
  });

  /**
   * QUOTE bookings NEVER carry a displayed_price (priceTotal stays NULL — the
   * indicative preview is not a price) and DEMAND configuration.description.
   */
  recompute = (ctx: PricingModeContext): null => {
    const description = ctx.configuration.description?.trim() ?? "";
    if (description.length < MIN_DESCRIPTION_LENGTH) {
      throw ApiError.unprocessable("A project description is required for quote services", {
        code: "QUOTE_DESCRIPTION_REQUIRED",
        min_length: MIN_DESCRIPTION_LENGTH,
      });
    }
    return null;
  };
}

export const quoteHandler = new QuoteHandler();
