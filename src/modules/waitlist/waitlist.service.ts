import { Prisma } from "@prisma/client";
import type { WaitlistSignup } from "@prisma/client";
import { waitlistRepository } from "./waitlist.repository";
import { WaitlistSource } from "../../enums";
import type { CreateWaitlistSignupDto, WaitlistSignupResponse } from "./waitlist.types";

/** Prisma enum -> PRD wire value. */
const SOURCE_WIRE: Record<WaitlistSource, string> = {
  [WaitlistSource.SERVICE_AREA_MISS]: "service-area-miss",
  [WaitlistSource.SERVICE_AREA_PAGE]: "service-area-page",
};

export class WaitlistService {
  /**
   * Idempotent capture. `@@unique([email, zip])` absorbs double-submits: a
   * duplicate returns the existing signup as a SUCCESS (created: false) — the
   * PRD forbids dead-ending the zip-miss flow, so no 409 here.
   *
   * Also consumed by bookingsService for the WAITLISTED arm of POST /bookings
   * (source: SERVICE_AREA_MISS).
   */
  async signup(
    dto: CreateWaitlistSignupDto,
  ): Promise<{ signup: WaitlistSignupResponse; created: boolean }> {
    const existing = await waitlistRepository.findByEmailZip(dto.email, dto.zip);
    if (existing) {
      return { signup: this.serialize(existing), created: false };
    }
    try {
      const row = await waitlistRepository.create({
        email: dto.email,
        zip: dto.zip,
        source: dto.source,
      });
      return { signup: this.serialize(row), created: true };
    } catch (err) {
      // Race: another request inserted [email, zip] between find and create.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const row = await waitlistRepository.findByEmailZip(dto.email, dto.zip);
        if (row) return { signup: this.serialize(row), created: false };
      }
      throw err;
    }
  }

  /** DB row -> PRD waitlist_signup contract (snake_case wire shape). */
  private serialize(row: WaitlistSignup): WaitlistSignupResponse {
    return {
      signup_id: row.id,
      brand: row.brand.toLowerCase(),
      email: row.email,
      zip: row.zip,
      source: SOURCE_WIRE[row.source],
      created_at: row.createdAt.toISOString(),
    };
  }
}

export const waitlistService = new WaitlistService();
