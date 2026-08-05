import type Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { ConfigStatus, MembershipStatus } from "../../enums";
import { env } from "../../config/env";
import { ApiError } from "../../utils/api-error";
import { logger } from "../../utils/logger";
import { randomToken } from "../../utils/tokens";
import { validateSelections, type ConfigInput, type GroupDescriptor, type PricingModeName } from "../../shared";
import { getStripe, brandMetadata, idemKey } from "../payments/stripe.client";
import { paymentsRepository, PaymentStatus } from "../payments/payments.repository";
import { usersService, usersRepository } from "../users";
import { serviceConfigRepository } from "../services/config/service-config.repository";
import { bookingsRepository } from "../bookings";
import { membershipsRepository, type MembershipWithRefs, type PlanWithRefs } from "./memberships.repository";
import type { MembershipConfig, MembershipView, PlanView } from "./memberships.types";

// Plans ARE ServicePlan now: lifecycle lives in the catalog module
// (/admin/catalog/plans); this module reads them, subscribes customers to them,
// and drives the Stripe lifecycle. A plan's price is BINDING — each billing
// cycle invoices exactly plan.price; the stored configuration only describes
// the JOB (selections/address/contact), never the amount.

const subId = (v: string | { id: string } | null | undefined): string | null =>
  typeof v === "string" ? v : (v?.id ?? null);

export class MembershipsService {
  // --- public ---
  async listPlans(): Promise<PlanView[]> {
    return (await membershipsRepository.listActivePlans()).map((p) => this.serializePlan(p));
  }

  // --- customer ---
  async subscribe(userId: string, dto: {
    planId: string;
    selections: Record<string, string | number | boolean | string[]>;
    quantity?: number;
    address: { street: string; city: string; state: string; zip: string };
  }): Promise<{ checkout_url: string | null }> {
    const plan = await membershipsRepository.findPlanById(dto.planId);
    if (!plan || plan.status !== ConfigStatus.ACTIVE || plan.cadence.interval === "NONE") {
      throw ApiError.badRequest("Plan unavailable", { code: "PLAN_UNAVAILABLE" });
    }
    // Plans without a Stripe price are display-only until the checkout stage wires them.
    if (!plan.stripePriceId) {
      throw ApiError.badRequest("This plan isn't open for subscription yet", { code: "PLAN_NOT_SUBSCRIBABLE" });
    }

    // Selections describe the job for the crew — validated, never priced.
    const cfg = await serviceConfigRepository.findServiceWithConfig(plan.serviceId);
    const groups: GroupDescriptor[] = (cfg?.configGroups ?? []).map((g) => ({
      key: g.key,
      inputType: g.inputType as ConfigInput,
      isRequired: g.isRequired,
      selectMin: g.selectMin,
      selectMax: g.selectMax,
      quantityMin: g.quantityMin,
      quantityMax: g.quantityMax,
      optionKeys: g.options.map((o) => o.key),
    }));
    const violations = validateSelections({
      selections: dto.selections,
      groups,
      pricingMode: (cfg?.pricingMode ?? "FROM") as PricingModeName,
      strict: true,
    });
    if (violations.length) throw ApiError.unprocessable("Invalid selections", { code: violations[0].code, violations });

    const user = await usersService.getById(userId);
    if (!user) throw ApiError.notFound("User not found", { code: "USER_NOT_FOUND" });
    const customerId = await this.ensureCustomer(userId);

    const config: MembershipConfig = {
      selections: dto.selections,
      quantity: dto.quantity ?? 1,
      address: dto.address,
      contact: { name: user.name, email: user.email, phone: user.phone },
    };
    const membership = await membershipsRepository.createMembership({
      userId,
      planId: plan.id,
      serviceId: plan.serviceId,
      status: MembershipStatus.INCOMPLETE,
      stripeSubscriptionId: `pending_${randomToken(16)}`,
      configuration: config as unknown as Prisma.InputJsonValue,
    });

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: plan.stripePriceId!, quantity: 1 }], // non-null: guarded above
      subscription_data: { metadata: { ...brandMetadata(), membershipId: membership.id } },
      metadata: { ...brandMetadata(), membershipId: membership.id },
      success_url: `${env.CLIENT_BASE_URL}/account?membership=success`,
      cancel_url: `${env.CLIENT_BASE_URL}/membership-plans?canceled=1`,
    });
    return { checkout_url: session.url };
  }

  async listMine(userId: string): Promise<MembershipView[]> {
    return (await membershipsRepository.listMembershipsByUser(userId)).map((m) => this.serializeMembership(m));
  }

  async cancel(userId: string, membershipId: string): Promise<{ canceled: boolean; effective: string }> {
    const membership = await membershipsRepository.findMembershipById(membershipId);
    if (!membership || membership.userId !== userId) {
      throw ApiError.notFound("Membership not found", { code: "MEMBERSHIP_NOT_FOUND" });
    }
    if (membership.stripeSubscriptionId.startsWith("pending_")) {
      throw ApiError.badRequest("Membership is not active yet", { code: "MEMBERSHIP_INACTIVE" });
    }
    await getStripe().subscriptions.update(membership.stripeSubscriptionId, { cancel_at_period_end: true });
    await membershipsRepository.updateMembership(membership.id, { cancelAtPeriodEnd: true });
    return { canceled: true, effective: "period_end" };
  }

  // --- webhook lifecycle (delegated from the payments webhook) ---
  async handleSubscriptionEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        const membershipId = s.metadata?.membershipId;
        const sub = subId(s.subscription);
        if (!membershipId || !sub) return;
        await membershipsRepository.updateMembership(membershipId, {
          stripeSubscriptionId: sub,
          status: MembershipStatus.ACTIVE,
        });
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const membership = await membershipsRepository.findMembershipBySubscription(sub.id);
        if (!membership) return;
        const status = event.type === "customer.subscription.deleted" ? MembershipStatus.CANCELED : this.mapStatus(sub.status);
        await membershipsRepository.updateMembership(membership.id, {
          status,
          currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
          cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
        });
        break;
      }
      case "invoice.created": {
        const inv = event.data.object as Stripe.Invoice;
        const sub = subId(inv.subscription);
        if (!sub) return;
        const membership = await membershipsRepository.findMembershipBySubscription(sub);
        if (!membership) return;
        // The plan's price is BINDING — every cycle invoices exactly this. The
        // old per-cycle recompute from the stored configuration is gone.
        const amount = membership.plan.price;
        await getStripe().invoiceItems.create(
          {
            customer: inv.customer as string,
            invoice: inv.id,
            amount,
            currency: membership.currency.toLowerCase(),
            description: `${membership.plan.name} — service for this billing cycle`,
          },
          { idempotencyKey: idemKey(`invitem_${inv.id}`) },
        );
        if (membership.lastAmount !== amount) {
          logger.info(`[membership] price change ${membership.id}: ${membership.lastAmount ?? "—"} -> ${amount} (notify member)`);
        }
        await membershipsRepository.updateMembership(membership.id, { lastAmount: amount });
        break;
      }
      case "invoice.paid": {
        const inv = event.data.object as Stripe.Invoice;
        const sub = subId(inv.subscription);
        if (!sub) return;
        const membership = await membershipsRepository.findMembershipBySubscription(sub);
        if (!membership) return;
        const config = membership.configuration as unknown as MembershipConfig;
        const currency = (inv.currency ?? "usd").toUpperCase();
        await paymentsRepository.create({
          userId: membership.userId,
          membershipId: membership.id,
          amount: inv.amount_paid,
          currency,
          status: PaymentStatus.SUCCEEDED,
          stripeInvoiceId: inv.id,
          idempotencyKey: idemKey(`inv_${inv.id}`),
        });
        await bookingsRepository.createSubscriptionVisit({
          customerId: membership.userId,
          serviceId: membership.serviceId,
          membershipId: membership.id,
          contact: config.contact,
          address: config.address,
          selections: config.selections as unknown as Prisma.InputJsonValue,
          quantity: config.quantity,
          amount: inv.amount_paid,
          currency,
        });
        await membershipsRepository.updateMembership(membership.id, { status: MembershipStatus.ACTIVE });
        break;
      }
      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice;
        const sub = subId(inv.subscription);
        if (!sub) return;
        const membership = await membershipsRepository.findMembershipBySubscription(sub);
        if (membership) await membershipsRepository.updateMembership(membership.id, { status: MembershipStatus.PAST_DUE });
        break;
      }
      default:
        break;
    }
  }

  private async ensureCustomer(userId: string): Promise<string> {
    const user = await usersService.getById(userId);
    if (!user) throw ApiError.notFound("User not found", { code: "USER_NOT_FOUND" });
    if (user.stripeCustomerId) return user.stripeCustomerId;
    const customer = await getStripe().customers.create({
      email: user.email,
      name: user.name,
      metadata: { ...brandMetadata(), userId },
    });
    await usersRepository.update(userId, { stripeCustomerId: customer.id });
    return customer.id;
  }

  private mapStatus(s: Stripe.Subscription.Status): MembershipStatus {
    switch (s) {
      case "active":
      case "trialing":
        return MembershipStatus.ACTIVE;
      case "past_due":
        return MembershipStatus.PAST_DUE;
      case "unpaid":
        return MembershipStatus.UNPAID;
      case "canceled":
        return MembershipStatus.CANCELED;
      case "paused":
        return MembershipStatus.PAUSED;
      default:
        return MembershipStatus.INCOMPLETE;
    }
  }

  private serializePlan(p: PlanWithRefs): PlanView {
    return {
      id: p.id,
      key: p.id,
      name: p.name,
      description: null,
      interval: p.cadence.interval,
      intervalCount: p.cadence.intervalCount,
      fromPrice: p.price,
      currency: p.service.currency,
      bullets: p.bullets,
      active: p.status === ConfigStatus.ACTIVE,
      service: p.service ? { slug: p.service.slug, name: p.service.name } : null,
    };
  }

  private serializeMembership(m: MembershipWithRefs): MembershipView {
    return {
      id: m.id,
      status: m.status,
      plan: m.plan ? { id: m.plan.id, name: m.plan.name } : null,
      service: m.service ? { slug: m.service.slug, name: m.service.name } : null,
      currentPeriodEnd: m.currentPeriodEnd ? m.currentPeriodEnd.toISOString() : null,
      cancelAtPeriodEnd: m.cancelAtPeriodEnd,
      lastAmount: m.lastAmount,
      currency: m.currency,
    };
  }
}

export const membershipsService = new MembershipsService();
