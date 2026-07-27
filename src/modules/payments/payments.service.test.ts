import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  piCreate: vi.fn(),
  piRetrieve: vi.fn(),
  refundCreate: vi.fn(),
  // payments.repository
  findEvent: vi.fn(),
  receiveEvent: vi.fn(),
  markEvent: vi.fn(),
  findById: vi.fn(),
  findByPaymentIntent: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  // cross-module
  setStatusById: vi.fn(),
  findForCustomerByReference: vi.fn(),
  record: vi.fn(),
}));

vi.mock("./stripe.client", () => ({
  getStripe: () => ({
    webhooks: { constructEvent: m.constructEvent },
    paymentIntents: { create: m.piCreate, retrieve: m.piRetrieve },
    refunds: { create: m.refundCreate },
  }),
  webhookSecret: () => "whsec_test",
  brandMetadata: () => ({ brand: "APEX" }),
  isApexObject: (meta: { brand?: string } | null | undefined) => meta?.brand === "APEX",
  idemKey: (s: string) => `apex_${s}`,
}));
vi.mock("./payments.repository", () => ({
  paymentsRepository: {
    findEvent: m.findEvent,
    receiveEvent: m.receiveEvent,
    markEvent: m.markEvent,
    findById: m.findById,
    findByPaymentIntent: m.findByPaymentIntent,
    create: m.create,
    update: m.update,
  },
  PaymentStatus: {
    REQUIRES_PAYMENT: "REQUIRES_PAYMENT", PROCESSING: "PROCESSING", SUCCEEDED: "SUCCEEDED",
    FAILED: "FAILED", CANCELED: "CANCELED", REFUNDED: "REFUNDED", PARTIALLY_REFUNDED: "PARTIALLY_REFUNDED",
  },
  StripeEventStatus: { RECEIVED: "RECEIVED", PROCESSED: "PROCESSED", FAILED: "FAILED" },
}));
vi.mock("../bookings", () => ({
  bookingsRepository: { setStatusById: m.setStatusById, findForCustomerByReference: m.findForCustomerByReference },
}));
vi.mock("../audit", () => ({ auditService: { record: m.record } }));

import { paymentsService } from "./payments.service";

function codeOf(p: Promise<unknown>) {
  return p.then(() => undefined).catch((e) => (e as { details?: { code?: string } }).details?.code);
}
const evt = (type: string, object: Record<string, unknown>, id = "e1") => ({ id, type, data: { object } });

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.findEvent.mockResolvedValue(null);
  m.receiveEvent.mockResolvedValue({});
  m.markEvent.mockResolvedValue({});
  m.update.mockResolvedValue({});
  m.setStatusById.mockResolvedValue({});
});

describe("handleWebhook — brand isolation + dedupe + amount backstop", () => {
  it("ignores events tagged for another brand (shared Stripe account)", async () => {
    m.constructEvent.mockReturnValue(evt("payment_intent.succeeded", { metadata: { brand: "ELEVATE" } }));
    const r = await paymentsService.handleWebhook(Buffer.from("{}"), "sig");
    expect(r).toEqual({ handled: false, reason: "other-brand" });
    expect(m.receiveEvent).not.toHaveBeenCalled();
  });

  it("skips an already-processed event (completion-gated dedupe)", async () => {
    m.constructEvent.mockReturnValue(evt("payment_intent.succeeded", { metadata: { brand: "APEX", paymentId: "p1" } }));
    m.findEvent.mockResolvedValue({ status: "PROCESSED" });
    const r = await paymentsService.handleWebhook(Buffer.from("{}"), "sig");
    expect(r).toEqual({ handled: true, reason: "duplicate" });
    expect(m.update).not.toHaveBeenCalled();
  });

  it("marks PAID on payment_intent.succeeded when amount matches", async () => {
    m.constructEvent.mockReturnValue(
      evt("payment_intent.succeeded", { id: "pi_1", amount: 16000, latest_charge: "ch_1", metadata: { brand: "APEX", paymentId: "p1" } }),
    );
    m.findById.mockResolvedValue({ id: "p1", amount: 16000, bookingId: "b1" });
    await paymentsService.handleWebhook(Buffer.from("{}"), "sig");
    expect(m.update).toHaveBeenCalledWith("p1", expect.objectContaining({ status: "SUCCEEDED" }));
    expect(m.setStatusById).toHaveBeenCalledWith("b1", "PAID");
    expect(m.markEvent).toHaveBeenCalledWith("e1", "PROCESSED");
  });

  it("does NOT mark PAID when the charged amount doesn't match the snapshot", async () => {
    m.constructEvent.mockReturnValue(
      evt("payment_intent.succeeded", { id: "pi_1", amount: 999, metadata: { brand: "APEX", paymentId: "p1" } }),
    );
    m.findById.mockResolvedValue({ id: "p1", amount: 16000, bookingId: "b1" });
    await paymentsService.handleWebhook(Buffer.from("{}"), "sig");
    expect(m.update).not.toHaveBeenCalled();
    expect(m.setStatusById).not.toHaveBeenCalled();
  });

  it("400s on a bad signature", async () => {
    m.constructEvent.mockImplementation(() => { throw new Error("bad sig"); });
    expect(await codeOf(paymentsService.handleWebhook(Buffer.from("{}"), "sig"))).toBe("INVALID_WEBHOOK_SIGNATURE");
  });
});

describe("refund — brand guard + cap", () => {
  const payment = { id: "p1", amount: 16000, refundedAmount: 0, stripePaymentIntentId: "pi_1", bookingId: "b1" };

  it("rejects refunding a non-Apex charge (shared account guard)", async () => {
    m.findById.mockResolvedValue(payment);
    m.piRetrieve.mockResolvedValue({ metadata: { brand: "ELEVATE" } });
    expect(await codeOf(paymentsService.refund("p1", undefined, "admin1"))).toBe("BRAND_MISMATCH");
    expect(m.refundCreate).not.toHaveBeenCalled();
  });

  it("rejects an over-refund", async () => {
    m.findById.mockResolvedValue(payment);
    m.piRetrieve.mockResolvedValue({ metadata: { brand: "APEX" } });
    expect(await codeOf(paymentsService.refund("p1", 20000, "admin1"))).toBe("REFUND_AMOUNT_INVALID");
    expect(m.refundCreate).not.toHaveBeenCalled();
  });

  it("issues a partial refund and audits it", async () => {
    m.findById.mockResolvedValue(payment);
    m.piRetrieve.mockResolvedValue({ metadata: { brand: "APEX" } });
    m.refundCreate.mockResolvedValue({ id: "re_1" });
    const r = await paymentsService.refund("p1", 5000, "admin1");
    expect(m.refundCreate).toHaveBeenCalledOnce();
    expect(r).toMatchObject({ refunded_amount: 5000, status: "PARTIALLY_REFUNDED" });
    expect(m.record).toHaveBeenCalled();
  });
});
