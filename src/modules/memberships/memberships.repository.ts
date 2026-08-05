import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/client";
import { ConfigStatus } from "../../enums";

// Plans ARE ServicePlan now (one entity); this repository only READS them —
// plan lifecycle lives in the catalog module (/admin/catalog/plans).
const planInclude = {
  service: { select: { slug: true, name: true, currency: true } },
  cadence: true,
} as const;
const membershipInclude = {
  plan: { select: { id: true, name: true, price: true } },
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
  /** Includes the plan — its binding price is the cycle amount at billing time. */
  findMembershipBySubscription(stripeSubscriptionId: string) {
    return prisma.membership.findUnique({
      where: { stripeSubscriptionId },
      include: { plan: { select: { id: true, name: true, price: true } } },
    });
  }
  listMembershipsByUser(userId: string) {
    return prisma.membership.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: membershipInclude,
    });
  }
}

export const membershipsRepository = new MembershipsRepository();
