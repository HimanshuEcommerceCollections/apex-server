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
  subscribeFromConfiguration: vi.fn(),
}));

vi.mock("../memberships", () => ({
  membershipsService: { subscribeFromConfiguration: m.subscribeFromConfiguration },
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

/** Ordinary booking: the one-time cadence, no discount, not a subscription. */
const ONE_TIME = { cadenceId: "cad-one", key: "one-time", label: "One-time", discountPercent: 0, isSubscription: false };
const WEEKLY = { cadenceId: "cad-wk", key: "weekly", label: "Weekly", discountPercent: 20, isSubscription: true };

function codeOf(p: Promise<unknown>) {
  return p.then(() => undefined).catch((e) => (e as { details?: { code?: string } }).details?.code);
}

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.findByIdOrSlug.mockResolvedValue({ id: "svc1", slug: "cleaning", status: "ACTIVE", pricingMode: "FROM" });
  m.findServiceWithConfig.mockResolvedValue({ configGroups: [] });
  m.findByClientRequestId.mockResolvedValue(null);
  m.recomputeForBooking.mockResolvedValue({ price: priced, cadence: ONE_TIME });
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

  it("snapshots the cadence and its discount onto the booking", async () => {
    m.isServiceAvailable.mockResolvedValue({ eligible: true });
    m.createBooked.mockResolvedValue({ id: "b1", reference: "APX-2025-0001", status: "AWAITING_PAYMENT" });

    await bookingsService.submit("cust1", baseDto as never);
    expect(m.createBooked).toHaveBeenCalledWith(
      expect.objectContaining({ cadence: { cadenceId: "cad-one", discountPercent: 0 } }),
    );
  });

  it("CHECKOUT (no booking) when a recurring frequency is chosen", async () => {
    m.isServiceAvailable.mockResolvedValue({ eligible: true });
    m.recomputeForBooking.mockResolvedValue({ price: priced, cadence: WEEKLY });
    m.subscribeFromConfiguration.mockResolvedValue({ checkout_url: "https://checkout/x", membership_id: "mem1" });

    const r = await bookingsService.submit("cust1", { ...baseDto, cadence_id: "cad-wk" } as never);

    expect(r).toMatchObject({ outcome: "CHECKOUT", checkout_url: "https://checkout/x", membership_id: "mem1" });
    // The whole point of forking at intake: no booking, so no payment window
    // and no PaymentIntent for something that bills on a schedule.
    expect(m.createBooked).not.toHaveBeenCalled();
    expect(m.subscribeFromConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ serviceId: "svc1", amount: 16000, cadence: WEEKLY }),
    );
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
