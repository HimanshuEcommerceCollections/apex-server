import type { User } from "@prisma/client";
import { env } from "../../config/env";
import { usersService } from "../users";
import { usersRepository } from "../users";
import { Role, TokenPurpose, UserStatus } from "../../enums";
import { ApiError } from "../../utils/api-error";
import { hashPassword, verifyPassword } from "../../utils/password";
import { signAccessToken } from "../../utils/jwt";
import { randomToken, sha256 } from "../../utils/tokens";
import { parseDurationMs } from "../../utils/duration";
import { emailService } from "../notifications";
import type { AuthResult, LoginDto, RegisterDto, SessionContext } from "./auth.types";

const REFRESH_TTL_MS = parseDurationMs(env.JWT_REFRESH_EXPIRES_IN);
const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

export class AuthService {
  /** Create a CUSTOMER account (email verification is created but not yet enforced). */
  async register(dto: RegisterDto, ctx: SessionContext): Promise<AuthResult> {
    const existing = await usersService.findByEmail(dto.email);
    if (existing) {
      throw ApiError.conflict("An account with this email already exists", { code: "EMAIL_TAKEN" });
    }
    const passwordHash = await hashPassword(dto.password);
    const user = await usersService.createUser({
      email: dto.email,
      name: dto.name,
      phone: dto.phone,
      passwordHash,
      role: Role.CUSTOMER,
      status: UserStatus.ACTIVE,
    });

    await this.issueEmailVerification(user);
    return this.establishSession(user, ctx);
  }

  /** Password login with soft, capped, per-account lockout. Uniform errors (no oracle). */
  async login(dto: LoginDto, ctx: SessionContext): Promise<AuthResult> {
    const user = await usersService.findByEmail(dto.email);
    if (!user || !user.passwordHash) {
      throw ApiError.unauthorized("Invalid email or password", { code: "INVALID_CREDENTIALS" });
    }
    usersService.assertNotLocked(user);

    const ok = await verifyPassword(dto.password, user.passwordHash);
    if (!ok) {
      await usersService.recordFailedLogin(user);
      throw ApiError.unauthorized("Invalid email or password", { code: "INVALID_CREDENTIALS" });
    }
    if (user.status === UserStatus.SUSPENDED) {
      throw ApiError.forbidden("Account suspended", { code: "ACCOUNT_SUSPENDED" });
    }
    if (user.status === UserStatus.INVITED) {
      throw ApiError.forbidden("Finish setting up your account from the invite email", {
        code: "ACCOUNT_INVITED",
      });
    }
    // Staff MFA (TOTP) is verified in Phase 7; mfaEnabledAt is null pre-enrollment.

    await usersService.resetLoginState(user.id);
    return this.establishSession(user, ctx);
  }

  /**
   * Rotate a refresh token. Reuse detection: presenting an already-rotated or
   * revoked token revokes the whole family AND bumps tokenVersion (kills every
   * live access token), then 401s.
   */
  async refresh(refreshRaw: string, ctx: SessionContext): Promise<AuthResult> {
    const tokenHash = sha256(refreshRaw);
    const row = await usersRepository.findRefreshByHash(tokenHash);
    if (!row) {
      throw ApiError.unauthorized("Invalid session", { code: "INVALID_REFRESH" });
    }
    if (row.revokedAt || row.replacedById) {
      // Reuse of a rotated/revoked token -> treat the whole family as compromised.
      await usersRepository.revokeFamily(row.familyId);
      await usersService.bumpTokenVersion(row.userId);
      throw ApiError.unauthorized("Session revoked", { code: "SESSION_REVOKED" });
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      throw ApiError.unauthorized("Session expired", { code: "SESSION_EXPIRED" });
    }
    const user = await usersService.getById(row.userId);
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw ApiError.unauthorized("Session revoked", { code: "SESSION_REVOKED" });
    }

    // Rotate within the same family.
    const raw = randomToken();
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
    const created = await usersRepository.createRefreshToken({
      userId: user.id,
      tokenHash: sha256(raw),
      familyId: row.familyId,
      expiresAt,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });
    await usersRepository.markRefreshReplaced(row.id, created.id);

    return {
      profile: usersService.serialize(user),
      accessToken: this.signFor(user),
      refreshRaw: raw,
      refreshExpiresAt: expiresAt,
    };
  }

  /** Revoke the presented refresh token's family (logs out that device lineage). */
  async logout(refreshRaw: string | undefined): Promise<void> {
    if (!refreshRaw) return;
    const row = await usersRepository.findRefreshByHash(sha256(refreshRaw));
    if (row && !row.revokedAt) {
      await usersRepository.revokeFamily(row.familyId);
    }
  }

  // --- helpers ---

  private signFor(user: User): string {
    return signAccessToken({
      sub: user.id,
      role: user.role,
      tokenVersion: user.tokenVersion,
      brand: "APEX",
    });
  }

  private async establishSession(user: User, ctx: SessionContext): Promise<AuthResult> {
    const raw = randomToken();
    const familyId = randomToken(16);
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
    await usersRepository.createRefreshToken({
      userId: user.id,
      tokenHash: sha256(raw),
      familyId,
      expiresAt,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });
    return {
      profile: usersService.serialize(user),
      accessToken: this.signFor(user),
      refreshRaw: raw,
      refreshExpiresAt: expiresAt,
    };
  }

  private async issueEmailVerification(user: User): Promise<void> {
    const raw = await usersService.createVerificationToken(
      user.id,
      TokenPurpose.EMAIL_VERIFY,
      EMAIL_VERIFY_TTL_MS,
    );
    await emailService.sendVerifyEmail(user.email, raw);
  }

  /** Confirm an email-verification token -> mark the account verified. */
  async verifyEmail(token: string): Promise<void> {
    const userId = await usersService.consumeVerificationToken(token, TokenPurpose.EMAIL_VERIFY);
    await usersService.markEmailVerified(userId);
  }

  /** Always resolves (no account-existence oracle); sends a reset link if applicable. */
  async forgotPassword(email: string): Promise<void> {
    const user = await usersService.findByEmail(email);
    if (user && user.passwordHash && user.status !== UserStatus.SUSPENDED) {
      const raw = await usersService.createVerificationToken(
        user.id,
        TokenPurpose.PASSWORD_RESET,
        PASSWORD_RESET_TTL_MS,
      );
      await emailService.sendPasswordReset(user.email, raw);
    }
  }

  /** Consume a reset token -> set the new password and revoke every session. */
  async resetPassword(token: string, password: string): Promise<void> {
    const userId = await usersService.consumeVerificationToken(token, TokenPurpose.PASSWORD_RESET);
    const passwordHash = await hashPassword(password);
    await usersService.setPasswordAndRevokeSessions(userId, passwordHash);
  }

  /** Consume a staff/pro invite token -> set the first password and activate. */
  async acceptInvite(token: string, password: string): Promise<void> {
    const userId = await usersService.consumeVerificationToken(token, [
      TokenPurpose.STAFF_INVITE,
      TokenPurpose.PRO_INVITE,
    ]);
    const passwordHash = await hashPassword(password);
    await usersService.activateFromInvite(userId, passwordHash);
  }
}

export const authService = new AuthService();
