import type { ProApplicationStatus } from "../../enums";

/** A Become-an-Apex-Pro application as the screening console reads it. */
export interface ProApplicationView {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  zip: string;
  trades: string[]; // service slugs
  /** Record<tradeSlug, Record<ackKey, boolean>> — collected, never verified (PRD). */
  acknowledgements: Record<string, Record<string, boolean>>;
  experience: string | null;
  company: string | null;
  availability: string | null;
  preferredStart: string | null;
  intro: string | null;
  status: ProApplicationStatus;
  notes: string | null;
  promotedUserId: string | null;
  createdAt: string;
  updatedAt: string;
}
