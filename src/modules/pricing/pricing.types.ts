import type { Selections } from "./engine/types";

/** Input to preview/recompute; mirrors the POST .../config/price body (deviation 4). */
export interface PricePreviewInput {
  selections?: Selections;
  quantity?: number;
  /** QUOTE project text (supplied by the booking pipeline, not the preview body). */
  description?: string;
  /**
   * Chosen payment frequency. Omitted = one-time. Must be a frequency the
   * service actively offers, otherwise the request is rejected.
   */
  cadenceId?: string;
}

export type {
  PricePreview,
  PricingCadence,
  PricingModeContext,
  PricingModeHandler,
  PricingServiceMeta,
} from "./modes/handler.types";
