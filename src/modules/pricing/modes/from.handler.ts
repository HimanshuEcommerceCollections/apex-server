import { PricingMode } from "../../../enums";
import { computePrice } from "../engine/compute-price";
import type { DisplayedPrice } from "../engine/types";
import type { PricePreview, PricingModeContext, PricingModeHandler } from "./handler.types";

/**
 * FROM — the binding pay-at-booking mode (it absorbed the former PRICED mode's
 * semantics when PricingMode collapsed to two values). The engine total IS the
 * amount the customer pays when the booking is created; basePrice is the payable
 * minimum (option deltas are >= 0, so total >= base by construction), and
 * Service.fromPrice is the marketing "from $X" display band — never a math input.
 */
class FromHandler implements PricingModeHandler {
  readonly mode = PricingMode.FROM;

  preview = (ctx: PricingModeContext): PricePreview => ({
    mode: this.mode,
    displayed_price: computePrice(ctx.table, ctx.configuration),
    from_price:
      ctx.service.fromPrice != null
        ? { amount: ctx.service.fromPrice, currency: ctx.service.currency }
        : null,
    is_from_band: true,
    requires_description: false,
    // Binding: the recomputed total is what gets charged at booking. No pro
    // confirmation of the price — the coordinator confirms the JOB, not the amount.
    requires_pro_confirmation: false,
  });

  recompute = (ctx: PricingModeContext): DisplayedPrice =>
    computePrice(ctx.table, ctx.configuration);
}

export const fromHandler = new FromHandler();
