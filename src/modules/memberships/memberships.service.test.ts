import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  // stripe.client
  invoiceItemsCreate: vi.fn(),
  checkoutCreate: vi.fn(),
  customersCreate: vi.fn(),
  subsUpdate: vi.fn(),
  // memberships.repository
  findPlanById: vi.fn(),
  createMembership: vi.fn(),
  updateMembership: vi.fn(),
  findMembershipById: vi.fn(),
  findMembershipBySubscription: vi.fn(),
  listMembershipsByUser: vi.fn(),
  // cross-module
  recompute: vi.fn(),
  paymentCreate: vi.fn(),
  createSubscriptionVisit: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock("../payments/stripe.client", () => ({
  getStripe: () => ({
    invoiceItems: { create: m.invoiceItemsCreate },
    checkout: { sessions: { create: m.checkoutCreate } },
    customers: { create: m.customersCreate },
    subscriptions: { update: m.subsUpdate },
  }),
  brandMetadata: () => ({ brand: "APEX" }),
  idemKey: (s: string) => `apex_${s}`,
}));
vi.mock("../payments/payments.repository", () => ({
  paymentsRepository: { create: m.paymentCreate },
  PaymentStatus: { SUCCEEDED: "SUCCEEDED" },
}));
vi.mock("./memberships.repository", () => ({
  membershipsRepository: {
    findPlanById: m.findPlanById,
    createMembership: m.createMembership,
    updateMembership: m.updateMembership,
    findMembershipById: m.findMembershipById,
    findMembershipBySubscription: m.findMembershipBySubscription,
    listMembershipsByUser: m.listMembershipsByUser,
  },
}));
vi.mock("../pricing", () => ({ pricingService: { recomputeForMembership: m.recompute } }));
vi.mock("../bookings", () => ({ bookingsRepository: { createSubscriptionVisit: m.createSubscriptionVisit } }));
vi.mock("../users", () => ({
  usersService: { getById: m.getUser },
  usersRepository: { update: m.updateUser },
}));
vi.mock("../services", () => ({ servicesRepository: {} }));
vi.mock("../services/config/service-config.repository", () => ({ serviceConfigRepository: {} }));

import { membershipsService } from "./memberships.service";

const evt = (type: string, object: Record<string, unknown>, id = "e1") => ({ id, type, data: { object } }) as never;
const config = {
  selections: { plan: "standard" },
  quantity: 1,
  address: { street: "1 A St", city: "Raleigh", state: "NC", zip: "27601" },
  contact: { name: "Pat", email: "pat@example.com", phone: null },
};

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.updateMembership.mockResolvedValue({});
});

describe("handleSubscriptionEvent — per-cycle recompute + fulfilment", () => {
  it("invoice.created: recomputes the current price and adds it as an invoice item", async () => {
    m.findMembershipBySubscription.mockResolvedValue({
      id: "mem1", serviceId: "svc1", userId: "u1", lastAmount: 12000, configuration: config,
    });
    m.recompute.mockResolvedValue({ amount: 15000, currency: "USD" });

    await membershipsService.handleSubscriptionEvent(
      evt("invoice.created", { id: "in_1", customer: "cus_1", subscription: "sub_1" }),
    );

    expect(m.recompute).toHaveBeenCalledWith("svc1", config.selections, 1);
    expect(m.invoiceItemsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_1", invoice: "in_1", amount: 15000, currency: "usd" }),
      expect.objectContaining({ idempotencyKey: "apex_invitem_in_1" }),
    );
    expect(m.updateMembership).toHaveBeenCalledWith("mem1", { lastAmount: 15000 });
  });

  it("invoice.paid: records the payment, creates a fulfilment visit, and marks ACTIVE", async () => {
    m.findMembershipBySubscription.mockResolvedValue({
      id: "mem1", serviceId: "svc1", userId: "u1", lastAmount: 15000, configuration: config,
    });
    m.paymentCreate.mockResolvedValue({});
    m.createSubscriptionVisit.mockResolvedValue({});

    await membershipsService.handleSubscriptionEvent(
      evt("invoice.paid", { id: "in_1", customer: "cus_1", subscription: "sub_1", amount_paid: 15000, currency: "usd" }),
    );

    expect(m.paymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ membershipId: "mem1", userId: "u1", amount: 15000, currency: "USD", status: "SUCCEEDED" }),
    );
    expect(m.createSubscriptionVisit).toHaveBeenCalledWith(
      expect.objectContaining({ membershipId: "mem1", serviceId: "svc1", customerId: "u1", quantity: 1 }),
    );
    expect(m.updateMembership).toHaveBeenCalledWith("mem1", { status: "ACTIVE" });
  });

  it("invoice.payment_failed: marks the membership PAST_DUE", async () => {
    m.findMembershipBySubscription.mockResolvedValue({ id: "mem1" });
    await membershipsService.handleSubscriptionEvent(
      evt("invoice.payment_failed", { id: "in_1", subscription: "sub_1" }),
    );
    expect(m.updateMembership).toHaveBeenCalledWith("mem1", { status: "PAST_DUE" });
  });

  it("customer.subscription.deleted: marks the membership CANCELED", async () => {
    m.findMembershipBySubscription.mockResolvedValue({ id: "mem1" });
    await membershipsService.handleSubscriptionEvent(
      evt("customer.subscription.deleted", { id: "sub_1", current_period_end: 1800000000, cancel_at_period_end: false }),
    );
    expect(m.updateMembership).toHaveBeenCalledWith(
      "mem1",
      expect.objectContaining({ status: "CANCELED" }),
    );
  });

  it("customer.subscription.updated: maps a past_due Stripe status to PAST_DUE", async () => {
    m.findMembershipBySubscription.mockResolvedValue({ id: "mem1" });
    await membershipsService.handleSubscriptionEvent(
      evt("customer.subscription.updated", { id: "sub_1", status: "past_due", current_period_end: 1800000000, cancel_at_period_end: true }),
    );
    expect(m.updateMembership).toHaveBeenCalledWith(
      "mem1",
      expect.objectContaining({ status: "PAST_DUE", cancelAtPeriodEnd: true }),
    );
  });

  it("checkout.session.completed: binds the real subscription id and activates", async () => {
    await membershipsService.handleSubscriptionEvent(
      evt("checkout.session.completed", { metadata: { membershipId: "mem1" }, subscription: "sub_live" }),
    );
    expect(m.updateMembership).toHaveBeenCalledWith("mem1", { stripeSubscriptionId: "sub_live", status: "ACTIVE" });
  });
});

describe("cancel", () => {
  it("schedules cancel_at_period_end for an active subscription", async () => {
    m.findMembershipById.mockResolvedValue({ id: "mem1", userId: "u1", stripeSubscriptionId: "sub_1" });
    m.subsUpdate.mockResolvedValue({});
    const r = await membershipsService.cancel("u1", "mem1");
    expect(m.subsUpdate).toHaveBeenCalledWith("sub_1", { cancel_at_period_end: true });
    expect(r).toEqual({ canceled: true, effective: "period_end" });
  });

  it("rejects cancelling a membership that never completed checkout", async () => {
    m.findMembershipById.mockResolvedValue({ id: "mem1", userId: "u1", stripeSubscriptionId: "pending_abc" });
    await expect(membershipsService.cancel("u1", "mem1")).rejects.toMatchObject({
      details: { code: "MEMBERSHIP_INACTIVE" },
    });
    expect(m.subsUpdate).not.toHaveBeenCalled();
  });

  it("does not let a user cancel someone else's membership", async () => {
    m.findMembershipById.mockResolvedValue({ id: "mem1", userId: "other", stripeSubscriptionId: "sub_1" });
    await expect(membershipsService.cancel("u1", "mem1")).rejects.toMatchObject({
      details: { code: "MEMBERSHIP_NOT_FOUND" },
    });
  });
});
