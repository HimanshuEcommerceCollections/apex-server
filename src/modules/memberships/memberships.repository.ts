import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/client";

const planInclude = { service: { select: { slug: true, name: true } } } as const;
const membershipInclude = {
  plan: { select: { key: true, name: true } },
  service: { select: { slug: true, name: true } },
} as const;

export type PlanWithService = Prisma.MembershipPlanGetPayload<{ include: typeof planInclude }>;
export type MembershipWithRefs = Prisma.MembershipGetPayload<{ include: typeof membershipInclude }>;

/** Sole writer of MembershipPlan + Membership. */
export class MembershipsRepository {
  // --- plans ---
  createPlan(data: Prisma.MembershipPlanUncheckedCreateInput) {
    return prisma.membershipPlan.create({ data, include: planInclude });
  }
  updatePlan(id: string, data: Prisma.MembershipPlanUncheckedUpdateInput) {
    return prisma.membershipPlan.update({ where: { id }, data, include: planInclude });
  }
  findPlanById(id: string) {
    return prisma.membershipPlan.findUnique({ where: { id }, include: planInclude });
  }
  listPlans(activeOnly: boolean) {
    return prisma.membershipPlan.findMany({
      where: activeOnly ? { active: true } : {},
      orderBy: { sortOrder: "asc" },
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
  findMembershipBySubscription(stripeSubscriptionId: string) {
    return prisma.membership.findUnique({ where: { stripeSubscriptionId } });
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
