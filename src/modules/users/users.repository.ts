import { prisma } from "../../db/client";
import type { Prisma } from "@prisma/client";

/**
 * Sole writer of User, RefreshToken, and VerificationToken (one-model-one-writer,
 * docs/architecture/07 §3). Thin, mechanical Prisma access only.
 */
export class UsersRepository {
  // --- User ---
  //
  // Every read here excludes soft-deleted rows. This is the single choke point
  // for it: resolveSession, login, refresh, forgot-password, token redemption
  // and the staff list all reach the database through these three methods, so
  // filtering here is what makes a deleted account genuinely unable to sign in
  // rather than merely hidden in one listing.
  findById(id: string) {
    return prisma.user.findFirst({ where: { id, deletedAt: null } });
  }
  findByEmail(email: string) {
    return prisma.user.findFirst({ where: { email, deletedAt: null } });
  }
  findManyByRoles(roles: Prisma.EnumRoleFilter["in"]) {
    return prisma.user.findMany({
      where: { role: { in: roles }, deletedAt: null },
      orderBy: [{ createdAt: "desc" }],
    });
  }
  /**
   * Deliberately UNFILTERED — the only read that sees soft-deleted rows.
   * `email` is unique across deleted and live rows alike, so re-inviting an
   * offboarded address has to find the old row to revive it rather than
   * colliding with the unique constraint. Do not use this for auth.
   */
  findAnyByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  }
  create(data: Prisma.UserUncheckedCreateInput) {
    return prisma.user.create({ data });
  }
  update(id: string, data: Prisma.UserUncheckedUpdateInput) {
    return prisma.user.update({ where: { id }, data });
  }
  /** Soft delete — see the `deletedAt` note on the model. */
  softDelete(id: string, data: Prisma.UserUncheckedUpdateInput) {
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
