import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/client";
import { ConfigStatus } from "../../enums";

// Plans ARE ServicePlan now (one entity); this repository only READS them —
// plan lifecycle lives in the catalog module (/admin/catalog/plans).
const planInclude = {
  service: { select: { slug: true, name: true, currency: true, taxRateBps: true } },
  cadence: true,
} as const;
const membershipInclude = {
  // plan is null for configuration-based subscriptions (service page + a
  // recurring payment frequency, no package behind it).
  plan: { select: { id: true, name: true, price: true } },
  cadence: { select: { id: true, key: true, label: true } },
  service: { select: { slug: true, name: true } },
} as const;

export type PlanWithRefs = Prisma.ServicePlanGetPayload<{ include: typeof planInclude }>;
export type MembershipWithRefs = Prisma.MembershipGetPayload<{ include: typeof membershipInclude }>;

/** Sole writer of Membership; reader of ServicePlan for the membership surface. */
export class MembershipsRepository {
  // --- plans (read-only here) ---
  findPlanById(id: string) {
    return prisma.servicePlan.findUnique({ where: { id }, include: planInclude });
  }

  /** Active plans on recurring cadences — the public membership catalog. */
  listActivePlans() {
    return prisma.servicePlan.findMany({
      where: {
        status: ConfigStatus.ACTIVE,
        cadence: { interval: { not: "NONE" }, status: ConfigStatus.ACTIVE },
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: planInclude,
    });
  }

  // --- memberships ---
  createMembership(data: Prisma.MembershipUncheckedCreateInput) {
    return prisma.membership.create({ data });
  }
  updateMembership(id: string, data: Prisma.MembershipUncheckedUpdateInput) {
    return prisma.membership.update({ where: { id }, data });
  }
  findMembershipById(id: string) {
    return prisma.membership.findUnique({ where: { id } });
  }
  /**
   * The cycle bills membership.amount (the signup snapshot) + tax. `plan` is
   * null for configuration-based subscriptions, so `cadence` is what names the
   * invoice line in that case.
   */
  findMembershipBySubscription(stripeSubscriptionId: string) {
    return prisma.membership.findUnique({
      where: { stripeSubscriptionId },
      include: {
        plan: { select: { id: true, name: true, price: true } },
        cadence: { select: { id: true, key: true, label: true } },
        service: { select: { id: true, name: true, taxRateBps: true } },
      },
    });
  }
  listMembershipsByUser(userId: string) {
    return prisma.membership.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: membershipInclude,
    });
  }

  // --- service recurring grid (Stripe anchor wiring for plan-less subs) ---
  findServiceRecurring(serviceId: string, cadenceId: string) {
    return prisma.serviceRecurring.findUnique({
      where: { serviceId_cadenceId: { serviceId, cadenceId } },
      include: {
        cadence: true,
        service: { select: { name: true, currency: true } },
      },
    });
  }
  updateServiceRecurring(id: string, data: Prisma.ServiceRecurringUncheckedUpdateInput) {
    return prisma.serviceRecurring.update({ where: { id }, data });
  }
}

export const membershipsRepository = new MembershipsRepository();
