import { PricingMode } from "../../../enums";
import { ApiError } from "../../../utils/api-error";
import type { PricePreview, PricingModeContext, PricingModeHandler } from "./handler.types";

const MIN_DESCRIPTION_LENGTH = 10;

class QuoteHandler implements PricingModeHandler {
  readonly mode = PricingMode.QUOTE;

  // QUOTE never runs the engine and never returns a price.
  preview = (_ctx: PricingModeContext): PricePreview => ({
    mode: this.mode,
    displayed_price: null,
    from_price: null,
    is_from_band: false,
    requires_description: true,
    requires_pro_confirmation: true,
  });

  /**
   * QUOTE bookings NEVER carry a displayed_price (priceTotal stays NULL) and
   * DEMAND configuration.description.
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
