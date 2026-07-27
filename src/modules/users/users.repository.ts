import { prisma } from "../../db/client";
import type { Prisma } from "@prisma/client";

/**
 * Sole writer of User, RefreshToken, and VerificationToken (one-model-one-writer,
 * docs/architecture/07 §3). Thin, mechanical Prisma access only.
 */
export class UsersRepository {
  // --- User ---
  findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  }
  findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  }
  findManyByRoles(roles: Prisma.EnumRoleFilter["in"]) {
    return prisma.user.findMany({
      where: { role: { in: roles } },
      orderBy: [{ createdAt: "desc" }],
    });
  }
  create(data: Prisma.UserUncheckedCreateInput) {
    return prisma.user.create({ data });
  }
  update(id: string, data: Prisma.UserUncheckedUpdateInput) {
    return prisma.user.update({ where: { id }, data });
  }

  // --- RefreshToken ---
  createRefreshToken(data: Prisma.RefreshTokenUncheckedCreateInput) {
    return prisma.refreshToken.create({ data });
  }
  findRefreshByHash(tokenHash: string) {
    return prisma.refreshToken.findUnique({ where: { tokenHash } });
  }
  markRefreshReplaced(id: string, replacedById: string) {
    return prisma.refreshToken.update({
      where: { id },
      data: { replacedById, revokedAt: new Date() },
    });
  }
  revokeFamily(familyId: string) {
    return prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  revokeAllRefreshForUser(userId: string) {
    return prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // --- VerificationToken ---
  createVerificationToken(data: Prisma.VerificationTokenUncheckedCreateInput) {
    return prisma.verificationToken.create({ data });
  }
  findVerificationByHash(tokenHash: string) {
    return prisma.verificationToken.findUnique({ where: { tokenHash } });
  }
  consumeVerification(id: string) {
    return prisma.verificationToken.update({ where: { id }, data: { consumedAt: new Date() } });
  }
}

export const usersRepository = new UsersRepository();
