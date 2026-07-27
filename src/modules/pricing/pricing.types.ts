import type { Selections } from "./engine/types";

/** Input to preview/recompute; mirrors the POST .../config/price body (deviation 4). */
export interface PricePreviewInput {
  selections?: Selections;
  quantity?: number;
  /** QUOTE project text (supplied by the booking pipeline, not the preview body). */
  description?: string;
}

export type {
  PricePreview,
  PricingModeContext,
  PricingModeHandler,
  PricingServiceMeta,
} from "./modes/handler.types";
