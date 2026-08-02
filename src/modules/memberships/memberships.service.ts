import type Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { MembershipStatus, type MembershipInterval } from "../../enums";
import { env } from "../../config/env";
import { ApiError } from "../../utils/api-error";
import { logger } from "../../utils/logger";
import { randomToken } from "../../utils/tokens";
import { validateSelections, type ConfigInput, type GroupDescriptor, type PricingModeName } from "../../shared";
import { getStripe, brandMetadata, idemKey } from "../payments/stripe.client";
import { paymentsRepository, PaymentStatus } from "../payments/payments.repository";
import { usersService, usersRepository } from "../users";
import { servicesRepository } from "../services";
import { serviceConfigRepository } from "../services/config/service-config.repository";
import { pricingService } from "../pricing";
import { bookingsRepository } from "../bookings";
import { membershipsRepository, type MembershipWithRefs, type PlanWithService } from "./memberships.repository";
import type { MembershipConfig, MembershipView, PlanView } from "./memberships.types";

const subId = (v: string | { id: string } | null | undefined): string | null =>
  typeof v === "string" ? v : (v?.id ?? null);

export class MembershipsService {
  // --- admin: plans ---
  async createPlan(dto: {
    key: string;
    name: string;
    description?: string;
    serviceId: string;
    interval: "WEEK" | "MONTH";
    intervalCount?: number;
    fromPrice?: number;
  }): Promise<PlanView> {
    const svc = await servicesRepository.findByIdOrSlug(dto.serviceId);
    if (!svc) throw ApiError.badRequest("Unknown service", { code: "SERVICE_NOT_FOUND" });
    const stripe = getStripe();
    const product = await stripe.products.create({
      name: dto.name,
      metadata: { ...brandMetadata(), planKey: dto.key },
    });
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: 0, // $0 cadence anchor; the real amount is a per-cycle invoice item
      currency: "usd",
      recurring: { interval: dto.interval.toLowerCase() as "week" | "month", interval_count: dto.intervalCount ?? 1 },
      metadata: brandMetadata(),
    });
    const plan = await membershipsRepository.createPlan({
      key: dto.key,
      name: dto.name,
      description: dto.description ?? null,
      serviceId: svc.id,
      interval: dto.interval as MembershipInterval,
      intervalCount: dto.intervalCount ?? 1,
      fromPrice: dto.fromPrice ?? null,
      stripeProductId: product.id,
      stripeAnchorPriceId: price.id,
      active: true,
    });
    return this.serializePlan(plan);
  }

  async updatePlan(
    id: string,
    changes: { name?: string; description?: string | null; active?: boolean; sortOrder?: number; fromPrice?: number | null },
  ): Promise<PlanView> {
    const existing = await membershipsRepository.findPlanById(id);
    if (!existing) throw ApiError.notFound("Plan not found", { code: "PLAN_NOT_FOUND" });
    const plan = await membershipsRepository.updatePlan(id, changes);
    return this.serializePlan(plan);
  }

  async listPlansAdmin(): Promise<PlanView[]> {
    return (await membershipsRepository.listPlans(false)).map((p) => this.serializePlan(p));
  }

  // --- public ---
  async listPlans(): Promise<PlanView[]> {
    return (await membershipsRepository.listPlans(true)).map((p) => this.serializePlan(p));
  }

  // --- customer ---
  async subscribe(userId: string, dto: {
    planId: string;
    selections: Record<string, string | number | boolean | string[]>;
    quantity?: number;
    address: { street: string; city: string; state: string; zip: string };
  }): Promise<{ checkout_url: string | null }> {
    const plan = await membershipsRepository.findPlanById(dto.planId);
    if (!plan || !plan.active) throw ApiError.badRequest("Plan unavailable", { code: "PLAN_UNAVAILABLE" });
    // Display-only plans (marketing catalog) have no Stripe anchor yet.
    if (!plan.stripeAnchorPriceId) {
      throw ApiError.badRequest("This plan isn't open for subscription yet", { code: "PLAN_NOT_SUBSCRIBABLE" });
    }

    const cfg = await serviceConfigRepository.findServiceWithConfig(plan.serviceId);
    const groups: GroupDescriptor[] = (cfg?.configGroups ?? []).map((g) => ({
      key: g.key,
      inputType: g.inputType as ConfigInput,
      isRequired: g.isRequired,
      selectMin: g.selectMin,
      selectMax: g.selectMax,
      optionKeys: g.options.map((o) => o.key),
    }));
    const violations = validateSelections({
      selections: dto.selections,
      groups,
      pricingMode: (cfg?.pricingMode ?? "PRICED") as PricingModeName,
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
      line_items: [{ price: plan.stripeAnchorPriceId!, quantity: 1 }], // non-null: guarded above
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
        const config = membership.configuration as unknown as MembershipConfig;
        const priced = await pricingService.recomputeForMembership(membership.serviceId, config.selections, config.quantity);
        await getStripe().invoiceItems.create(
          {
            customer: inv.customer as string,
            invoice: inv.id,
            amount: priced.amount,
            currency: priced.currency.toLowerCase(),
            description: "Service for this billing cycle",
          },
          { idempotencyKey: idemKey(`invitem_${inv.id}`) },
        );
        if (membership.lastAmount !== priced.amount) {
          logger.info(`[membership] price change ${membership.id}: ${membership.lastAmount ?? "—"} -> ${priced.amount} (notify member)`);
        }
        await membershipsRepository.updateMembership(membership.id, { lastAmount: priced.amount });
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

  private serializePlan(p: PlanWithService): PlanView {
    return {
      id: p.id,
      key: p.key,
      name: p.name,
      description: p.description,
      interval: p.interval,
      intervalCount: p.intervalCount,
      fromPrice: p.fromPrice,
      currency: p.currency,
      active: p.active,
      service: p.service ? { slug: p.service.slug, name: p.service.name } : null,
    };
  }

  private serializeMembership(m: MembershipWithRefs): MembershipView {
    return {
      id: m.id,
      status: m.status,
      plan: m.plan ? { key: m.plan.key, name: m.plan.name } : null,
      service: m.service ? { slug: m.service.slug, name: m.service.name } : null,
      currentPeriodEnd: m.currentPeriodEnd ? m.currentPeriodEnd.toISOString() : null,
      cancelAtPeriodEnd: m.cancelAtPeriodEnd,
      lastAmount: m.lastAmount,
      currency: m.currency,
    };
  }
}

export const membershipsService = new MembershipsService();
