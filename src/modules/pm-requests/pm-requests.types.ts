import type { PMBundle, QuoteStatus } from "../../enums";

/**
 * A property-manager enquiry as the coordinator console reads it: the B2B fields
 * off PMRequest joined with the triage state (status, price, contact) that lives
 * on its parent QuoteRequest.
 */
export interface PmRequestView {
  id: string;
  quoteRequestId: string;
  company: string | null;
  unitsEst: number;
  bundle: PMBundle;
  scopeNotes: string;
  // --- from the parent QuoteRequest ---
  status: QuoteStatus;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  quotedAmount: number | null; // cents
  quotedAt: string | null;
  currency: string;
  createdAt: string;
}
