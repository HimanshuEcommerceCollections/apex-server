import type { Prisma, User } from "@prisma/client";
import { usersRepository } from "./users.repository";
import { Role, TokenPurpose, UserStatus } from "../../enums";
import { ApiError } from "../../utils/api-error";
import { randomToken, sha256 } from "../../utils/tokens";
import { emailService } from "../notifications";
import type { AccessTokenClaims } from "../../utils/jwt";
import type { AuthUser } from "../../types/common.types";
import type { CreateUserInput, UpdateMeDto, UserProfile } from "./users.types";

const STAFF_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const LOCK_THRESHOLD = 5;
const LOCK_BASE_MS = 60_000; // 1 min
const LOCK_MAX_MS = 15 * 60_000; // capped so a targeted attacker can't lock a victim out for long

export class UsersService {
  /**
   * Per-request session guard (registered onto `authenticate`, 07 §3.1). The
   * access token is only trusted if the user still exists, is ACTIVE, and the
   * token's `tokenVersion` matches — so suspend/offboard and refresh-reuse
   * revocation take effect immediately.
   */
  async resolveSession(claims: AccessTokenClaims): Promise<AuthUser | null> {
    const user = await usersRepository.findById(claims.sub);
    if (!user || user.status !== UserStatus.ACTIVE) return null;
    if (user.tokenVersion !== claims.tokenVersion) return null;
    return { id: user.id, role: user.role, tokenVersion: user.tokenVersion };
  }

  getById(id: string): Promise<User | null> {
    return usersRepository.findById(id);
  }

  findByEmail(email: string): Promise<User | null> {
    return usersRepository.findByEmail(email.trim().toLowerCase());
  }

  async createUser(input: CreateUserInput): Promise<User> {
    return usersRepository.create({
      email: input.email.trim().toLowerCase(),
      name: input.name,
      phone: input.phone ?? null,
      passwordHash: input.passwordHash ?? null,
      role: input.role ?? Role.CUSTOMER,
      status: input.status ?? UserStatus.ACTIVE,
    });
  }

  async getProfileOrThrow(id: string): Promise<UserProfile> {
    const user = await usersRepository.findById(id);
    if (!user) throw ApiError.notFound("User not found", { code: "USER_NOT_FOUND" });
    return this.serialize(user);
  }

  async updateProfile(id: string, dto: UpdateMeDto): Promise<UserProfile> {
    const user = await usersRepository.update(id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
    });
    return this.serialize(user);
  }

  // --- login-state (soft, per-account, capped — not tied to IP to avoid the
  //     IP+email lockout DoS; CAPTCHA is the preferred escalation, Phase later) ---

  assertNotLocked(user: User): void {
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const retryAfterSec = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
      throw ApiError.unauthorized("Account temporarily locked. Try again later.", {
        code: "ACCOUNT_LOCKED",
        retryAfterSec,
      });
    }
  }

  async recordFailedLogin(user: User): Promise<void> {
    const failed = user.failedLoginCount + 1;
    let lockedUntil: Date | null = null;
    if (failed >= LOCK_THRESHOLD) {
      const backoff = Math.min(LOCK_MAX_MS, LOCK_BASE_MS * 2 ** (failed - LOCK_THRESHOLD));
      lockedUntil = new Date(Date.now() + backoff);
    }
    await usersRepository.update(user.id, { failedLoginCount: failed, lockedUntil });
  }

  async resetLoginState(id: string): Promise<void> {
    await usersRepository.update(id, { failedLoginCount: 0, lockedUntil: null });
  }

  /** Bump tokenVersion to invalidate every live access token for a user. */
  async bumpTokenVersion(id: string): Promise<void> {
    await usersRepository.update(id, { tokenVersion: { increment: 1 } });
  }

  // --- verification / invite tokens (users owns VerificationToken) ---

  /** Mint a single-use token; returns the RAW value (stored only as a hash). */
  async createVerificationToken(
    userId: string,
    purpose: TokenPurpose,
    ttlMs: number,
  ): Promise<string> {
    const raw = randomToken();
    await usersRepository.createVerificationToken({
      userId,
      purpose,
      tokenHash: sha256(raw),
      expiresAt: new Date(Date.now() + ttlMs),
    });
    return raw;
  }

  /** Validate + consume a token; returns the owning userId. Throws on any problem. */
  async consumeVerificationToken(
    raw: string,
    purpose: TokenPurpose | TokenPurpose[],
  ): Promise<string> {
    const allowed = Array.isArray(purpose) ? purpose : [purpose];
    const row = await usersRepository.findVerificationByHash(sha256(raw));
    if (!row || !allowed.includes(row.purpose)) {
      throw ApiError.badRequest("Invalid token", { code: "INVALID_TOKEN" });
    }
    if (row.consumedAt) throw ApiError.badRequest("Token already used", { code: "TOKEN_USED" });
    if (row.expiresAt.getTime() <= Date.now()) {
      throw ApiError.badRequest("Token expired", { code: "TOKEN_EXPIRED" });
    }
    await usersRepository.consumeVerification(row.id);
    return row.userId;
  }

  async markEmailVerified(id: string): Promise<void> {
    await usersRepository.update(id, { emailVerifiedAt: new Date() });
  }

  /** Reset flow: set a new password, kill all sessions (access + refresh). */
  async setPasswordAndRevokeSessions(id: string, passwordHash: string): Promise<void> {
    await usersRepository.update(id, {
      passwordHash,
      tokenVersion: { increment: 1 },
      failedLoginCount: 0,
      lockedUntil: null,
    });
    await usersRepository.revokeAllRefreshForUser(id);
  }

  /** Invite flow: set the first password and activate the account (email is proven). */
  async activateFromInvite(id: string, passwordHash: string): Promise<void> {
    await usersRepository.update(id, {
      passwordHash,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    });
  }

  // --- admin: staff management (capability user:manage) ---

  async listStaff(roleFilter?: Role): Promise<UserProfile[]> {
    const roles = roleFilter ? [roleFilter] : [Role.COORDINATOR, Role.ADMIN];
    const rows = await usersRepository.findManyByRoles(roles);
    return rows.map((u) => this.serialize(u));
  }

  /** Invite a coordinator/admin: create an INVITED account + send a STAFF_INVITE email. */
  async inviteStaff(input: {
    email: string;
    name: string;
    role: Role;
    phone?: string;
  }): Promise<UserProfile> {
    const existing = await this.findByEmail(input.email);
    if (existing) {
      throw ApiError.conflict("A user with this email already exists", { code: "EMAIL_TAKEN" });
    }
    const user = await this.createUser({
      email: input.email,
      name: input.name,
      phone: input.phone,
      role: input.role,
      status: UserStatus.INVITED,
      passwordHash: null,
    });
    const raw = await this.createVerificationToken(user.id, TokenPurpose.STAFF_INVITE, STAFF_INVITE_TTL_MS);
    await emailService.sendInvite(user.email, raw, input.role === Role.ADMIN ? "admin" : "coordinator");
    return this.serialize(user);
  }

  /** Suspend/reactivate or change a staff member's role. Suspending kills sessions. */
  async updateStaff(
    id: string,
    changes: { status?: "ACTIVE" | "SUSPENDED"; role?: Role },
  ): Promise<UserProfile> {
    const target = await usersRepository.findById(id);
    if (!target) throw ApiError.notFound("User not found", { code: "USER_NOT_FOUND" });

    const data: Prisma.UserUncheckedUpdateInput = {};
    if (changes.role) data.role = changes.role;
    if (changes.status) {
      data.status = changes.status as UserStatus;
      if (changes.status === "SUSPENDED") data.tokenVersion = { increment: 1 };
    }
    const updated = await usersRepository.update(id, data);
    if (changes.status === "SUSPENDED") await usersRepository.revokeAllRefreshForUser(id);
    return this.serialize(updated);
  }

  serialize(user: User): UserProfile {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      role: user.role,
      status: user.status,
      emailVerified: user.emailVerifiedAt !== null,
      mfaEnabled: user.mfaEnabledAt !== null,
      createdAt: user.createdAt.toISOString(),
    };
  }
}

export const usersService = new UsersService();
