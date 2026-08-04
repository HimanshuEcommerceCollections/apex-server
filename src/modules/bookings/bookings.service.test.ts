import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findByIdOrSlug: vi.fn(),
  findServiceWithConfig: vi.fn(),
  isServiceAvailable: vi.fn(),
  recomputeForBooking: vi.fn(),
  signup: vi.fn(),
  record: vi.fn(),
  findByClientRequestId: vi.fn(),
  createBooked: vi.fn(),
}));

vi.mock("../services", () => ({ servicesRepository: { findByIdOrSlug: m.findByIdOrSlug } }));
vi.mock("../services/config/service-config.repository", () => ({
  serviceConfigRepository: { findServiceWithConfig: m.findServiceWithConfig },
}));
vi.mock("../service-area", () => ({ availabilityService: { isServiceAvailable: m.isServiceAvailable } }));
vi.mock("../pricing", () => ({ pricingService: { recomputeForBooking: m.recomputeForBooking } }));
vi.mock("../waitlist", () => ({ waitlistService: { signup: m.signup } }));
vi.mock("../demo-inbox", () => ({ demoInboxService: { record: m.record } }));
vi.mock("./bookings.repository", () => ({
  bookingsRepository: { findByClientRequestId: m.findByClientRequestId, createBooked: m.createBooked },
}));

import { bookingsService } from "./bookings.service";

const baseDto = {
  service_type: "cleaning",
  configuration: { selections: {} as Record<string, never> },
  contact: { name: "Sam", email: "sam@example.com" },
  address: { street: "1 Main", city: "Cary", state: "NC", zip: "27513" },
};

const priced = { total: { amount: 16000, currency: "USD" }, line_items: [], pricing_version: "v1", is_estimate: true };

function codeOf(p: Promise<unknown>) {
  return p.then(() => undefined).catch((e) => (e as { details?: { code?: string } }).details?.code);
}

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.findByIdOrSlug.mockResolvedValue({ id: "svc1", slug: "cleaning", status: "ACTIVE", pricingMode: "FROM" });
  m.findServiceWithConfig.mockResolvedValue({ configGroups: [] });
  m.findByClientRequestId.mockResolvedValue(null);
  m.recomputeForBooking.mockResolvedValue(priced);
  m.record.mockResolvedValue(undefined);
});

describe("bookings.submit", () => {
  it("BOOKED when the ZIP is served", async () => {
    m.isServiceAvailable.mockResolvedValue({ eligible: true });
    m.createBooked.mockResolvedValue({ id: "b1", reference: "APX-2025-0001", status: "PENDING" });

    const r = await bookingsService.submit("cust1", baseDto as never);
    expect(r).toMatchObject({ outcome: "BOOKED", reference: "APX-2025-0001", booking_id: "b1" });
    expect(m.createBooked).toHaveBeenCalledOnce();
    expect(m.record).toHaveBeenCalled(); // demo-inbox
  });

  it("WAITLISTED (no booking) when the ZIP is out of area", async () => {
    m.isServiceAvailable.mockResolvedValue({ eligible: false, reason: "nope" });
    m.signup.mockResolvedValue({ signup: { signup_id: "w1", zip: "99999" }, created: true });

    const r = await bookingsService.submit("cust1", { ...baseDto, address: { ...baseDto.address, zip: "99999" } } as never);
    expect(r.outcome).toBe("WAITLISTED");
    expect(m.signup).toHaveBeenCalledOnce();
    expect(m.createBooked).not.toHaveBeenCalled();
  });

  it("idempotent replay returns the original booking without re-creating", async () => {
    m.findByClientRequestId.mockResolvedValue({ id: "b1", reference: "APX-2025-0001", status: "PENDING" });
    const r = await bookingsService.submit("cust1", { ...baseDto, request_id: "11111111-1111-1111-1111-111111111111" } as never);
    expect(r).toMatchObject({ outcome: "BOOKED", reference: "APX-2025-0001" });
    expect(m.isServiceAvailable).not.toHaveBeenCalled();
    expect(m.createBooked).not.toHaveBeenCalled();
  });

  it("rejects unknown or non-active services", async () => {
    m.findByIdOrSlug.mockResolvedValue(null);
    expect(await codeOf(bookingsService.submit("c", baseDto as never))).toBe("SERVICE_NOT_FOUND");
    m.findByIdOrSlug.mockResolvedValue({ id: "s", slug: "x", status: "DRAFT", pricingMode: "FROM" });
    expect(await codeOf(bookingsService.submit("c", baseDto as never))).toBe("SERVICE_NOT_BOOKABLE");
  });
});
