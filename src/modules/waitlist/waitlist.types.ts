import type { z } from "zod";
import type { createWaitlistSignupSchema } from "./waitlist.validation";

export type CreateWaitlistSignupDto = z.infer<typeof createWaitlistSignupSchema>;

/** PRD waitlist_signup contract shape (snake_case on the wire). */
export interface WaitlistSignupResponse {
  signup_id: string;
  brand: string; // "apex"
  email: string;
  zip: string;
  name: string | null;
  phone: string | null;
  source: string; // "service-area-miss" | "service-area-page"
  created_at: string; // ISO-8601
}

/** Wire `data` shape for POST /waitlist. */
export interface WaitlistSignupResult {
  waitlist_signup: WaitlistSignupResponse;
  created: boolean; // false on the idempotent duplicate path (analytics signal)
}
