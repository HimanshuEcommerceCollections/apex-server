import { PricingMode } from "../../../enums";
import { computePrice } from "../engine/compute-price";
import type { DisplayedPrice } from "../engine/types";
import type { PricePreview, PricingModeContext, PricingModeHandler } from "./handler.types";

class PricedHandler implements PricingModeHandler {
  readonly mode = PricingMode.PRICED;

  preview = (ctx: PricingModeContext): PricePreview => ({
    mode: this.mode,
    displayed_price: computePrice(ctx.table, ctx.configuration),
    from_price: null,
    is_from_band: false,
    requires_description: false,
    requires_pro_confirmation: false,
  });

  recompute = (ctx: PricingModeContext): DisplayedPrice =>
    computePrice(ctx.table, ctx.configuration);
}

export const pricedHandler = new PricedHandler();
