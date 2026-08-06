import type { DisplayedPrice, Money } from "./types";
import { negateMoney } from "./money";

/**
 * Apply a recurring cadence discount to a computed price.
 *
 * Deliberately NOT inside computePrice: that function is strictly additive by
 * contract (base + option deltas + quantity × unit + fees), and the cadence %
 * is the one discount in the system, applied by the caller on top of the
 * configured pre-tax total. Keeping it here preserves that contract and keeps
 * the discount visible as its own line item.
 *
 * The discounted total is what everything downstream charges: tax computes on
 * it, and BookingConfiguration.grandTotal snapshots it. `subtotal` is left as
 * the pre-discount figure so a receipt can show what was taken off.
 */
export function applyRecurringDiscount(price: DisplayedPrice, discountPercent: number): DisplayedPrice {
  if (!Number.isInteger(discountPercent) || discountPercent <= 0) return price;
  const pct = Math.min(100, discountPercent);

  const off: Money = {
    // Round the discount, not the remainder, so the line item and the total
    // always reconcile exactly.
    amount: Math.round((price.total.amount * pct) / 100),
    currency: price.total.currency,
  };
  if (off.amount === 0) return price;

  return {
    ...price,
    total: { amount: price.total.amount - off.amount, currency: price.total.currency },
    line_items: [
      ...price.line_items,
      { label: `Recurring discount (${pct}%)`, amount: negateMoney(off), kind: "discount" },
    ],
  };
}
