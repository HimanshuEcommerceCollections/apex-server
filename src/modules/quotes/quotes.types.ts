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
  currency: string;
  booking: { reference: string } | null;
  service: { slug: string; name: string } | null;
  createdAt: string;
}
