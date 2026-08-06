import { PricingMode } from "../../../enums";
import { computePrice } from "../engine/compute-price";
import { applyRecurringDiscount } from "../engine/recurring-discount";
import type { DisplayedPrice } from "../engine/types";
import type { PricePreview, PricingModeContext, PricingModeHandler } from "./handler.types";

/**
 * FROM — the binding pay-at-booking mode (it absorbed the former PRICED mode's
 * semantics when PricingMode collapsed to two values). The engine total IS the
 * amount the customer pays when the booking is created, and basePrice is BOTH
 * the payable minimum and the "from $X" the site lists — one number, honest by
 * construction (option deltas are >= 0, so total >= base always).
 */
class FromHandler implements PricingModeHandler {
  readonly mode = PricingMode.FROM;

  preview = (ctx: PricingModeContext): PricePreview => ({
    mode: this.mode,
    displayed_price: applyRecurringDiscount(
      computePrice(ctx.table, ctx.configuration),
      ctx.cadence.discountPercent,
    ),
    // The listed minimum; a 0 base means the service lists no from-price. Left
    // undiscounted: it is the "from $X" the site advertises, not this quote.
    from_price:
      ctx.service.basePrice > 0
        ? { amount: ctx.service.basePrice, currency: ctx.service.currency }
        : null,
    cadence: ctx.cadence,
    is_from_band: true,
    requires_description: false,
    // Binding: the recomputed total is what gets charged at booking. No pro
    // confirmation of the price — the coordinator confirms the JOB, not the amount.
    requires_pro_confirmation: false,
  });

  recompute = (ctx: PricingModeContext): DisplayedPrice =>
    applyRecurringDiscount(computePrice(ctx.table, ctx.configuration), ctx.cadence.discountPercent);
}

export const fromHandler = new FromHandler();
