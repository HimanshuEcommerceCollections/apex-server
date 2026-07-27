import { PricingMode } from "../../../enums";
import { computePrice } from "../engine/compute-price";
import type { DisplayedPrice } from "../engine/types";
import type { PricePreview, PricingModeContext, PricingModeHandler } from "./handler.types";

class FromHandler implements PricingModeHandler {
  readonly mode = PricingMode.FROM;

  preview = (ctx: PricingModeContext): PricePreview => ({
    mode: this.mode,
    // Same engine, same math as PRICED — the difference is FRAMING, not
    // computation. Service.fromPrice is the display band and is never a math input.
    displayed_price: computePrice(ctx.table, ctx.configuration),
    from_price:
      ctx.service.fromPrice != null
        ? { amount: ctx.service.fromPrice, currency: ctx.service.currency }
        : null,
    is_from_band: true,
    requires_description: false,
    requires_pro_confirmation: true,
  });

  recompute = (ctx: PricingModeContext): DisplayedPrice =>
    computePrice(ctx.table, ctx.configuration);
}

export const fromHandler = new FromHandler();
