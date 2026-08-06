import type { PricingMode } from "../../../enums";
import type { DisplayedPrice, EngineConfiguration, Money, PricingTable } from "../engine/types";

/** The Service fields handlers need (subset of the Prisma Service row). */
export interface PricingServiceMeta {
  id: string;
  slug: string;
  pricingRef: string;
  pricingMode: PricingMode;
  basePrice: number; // integer cents; the payable minimum AND the listed "from $X" (0 = none shown)
  currency: string;
}

/**
 * The chosen payment frequency, resolved against the service's Recurring grid.
 * Always present — an ordinary booking resolves to the one-time cadence, which
 * carries a 0% discount and `isSubscription: false`.
 */
export interface PricingCadence {
  cadenceId: string;
  key: string;
  label: string;
  discountPercent: number;
  /** interval !== NONE — the single source of "does this bill on a schedule?". */
  isSubscription: boolean;
}

export interface PricingModeContext {
  service: PricingServiceMeta;
  table: PricingTable;
  configuration: EngineConfiguration;
  cadence: PricingCadence;
}

/** The Step-3 preview payload — also the `data` of POST .../config/price. */
export interface PricePreview {
  mode: PricingMode;
  displayed_price: DisplayedPrice | null; // null iff mode === QUOTE
  from_price: Money | null; // FROM only; basePrice when > 0 (the listed minimum), else null
  /** Echo of the applied frequency, so the client can render what it got. */
  cadence: PricingCadence;
  is_from_band: boolean; // true iff mode === FROM
  requires_description: boolean; // true iff mode === QUOTE
  requires_pro_confirmation: boolean; // true for FROM and QUOTE
}

export interface PricingModeHandler {
  readonly mode: PricingMode;
  /** Step-3 live preview. Never throws for a missing description. */
  preview(ctx: PricingModeContext): PricePreview;
  /** Authoritative recompute inside POST /bookings — null for QUOTE. */
  recompute(ctx: PricingModeContext): DisplayedPrice | null;
}
