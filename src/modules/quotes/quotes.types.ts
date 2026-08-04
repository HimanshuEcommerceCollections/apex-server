import type { QuoteSource, QuoteStatus } from "../../enums";

export interface QuoteView {
  id: string;
  status: QuoteStatus;
  source: QuoteSource;
  description: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  quotedAmount: number | null;
  quotedAt: string | null;
  /**
   * Engine total for the customer's stored configuration (cents) — an INDICATIVE
   * starting point for the coordinator, never binding, null when the quote has no
   * booking configuration (e.g. PM requests) or the engine can't price it.
   */
  indicativeAmount: number | null;
  currency: string;
  booking: { reference: string } | null;
  service: { slug: string; name: string } | null;
  createdAt: string;
}
