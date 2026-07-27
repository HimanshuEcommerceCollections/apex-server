import { beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  findById: vi.fn(),
  update: vi.fn(),
  findVerificationByHash: vi.fn(),
  consumeVerification: vi.fn(),
  createVerificationToken: vi.fn(),
  revokeAllRefreshForUser: vi.fn(),
}));
vi.mock("./users.repository", () => ({ usersRepository: repo }));

import { usersService } from "./users.service";
import { Role, TokenPurpose, UserStatus } from "../../enums";

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { details?: { code?: string } }).details?.code;
  }
}

const baseUser = {
  id: "u1",
  role: Role.CUSTOMER,
  status: UserStatus.ACTIVE,
  tokenVersion: 3,
  failedLoginCount: 0,
  lockedUntil: null as Date | null,
};

beforeEach(() => {
  Object.values(repo).forEach((f) => f.mockReset());
  repo.update.mockResolvedValue(baseUser);
  repo.consumeVerification.mockResolvedValue({});
  repo.revokeAllRefreshForUser.mockResolvedValue({ count: 0 });
});

describe("resolveSession (session guard, 07 §3.1)", () => {
  it("returns the principal when active and tokenVersion matches", async () => {
    repo.findById.mockResolvedValue({ ...baseUser });
    const out = await usersService.resolveSession({
      sub: "u1",
      role: Role.CUSTOMER,
      tokenVersion: 3,
      brand: "APEX",
    });
    expect(out).toEqual({ id: "u1", role: Role.CUSTOMER, tokenVersion: 3 });
  });

  it("returns null when the user is suspended", async () => {
    repo.findById.mockResolvedValue({ ...baseUser, status: UserStatus.SUSPENDED });
    const out = await usersService.resolveSession({
      sub: "u1",
      role: Role.CUSTOMER,
      tokenVersion: 3,
      brand: "APEX",
    });
    expect(out).toBeNull();
  });

  it("returns null on tokenVersion mismatch (revoked session)", async () => {
    repo.findById.mockResolvedValue({ ...baseUser, tokenVersion: 4 });
    const out = await usersService.resolveSession({
      sub: "u1",
      role: Role.CUSTOMER,
      tokenVersion: 3,
      brand: "APEX",
    });
    expect(out).toBeNull();
  });

  it("returns null when the user is missing", async () => {
    repo.findById.mockResolvedValue(null);
    const out = await usersService.resolveSession({
      sub: "gone",
      role: Role.CUSTOMER,
      tokenVersion: 0,
      brand: "APEX",
    });
    expect(out).toBeNull();
  });
});

describe("recordFailedLogin (soft, capped lockout)", () => {
  it("does not lock before the threshold", async () => {
    await usersService.recordFailedLogin({ ...baseUser, failedLoginCount: 0 } as never);
    expect(repo.update).toHaveBeenCalledWith("u1", { failedLoginCount: 1, lockedUntil: null });
  });

  it("locks once the threshold is reached", async () => {
    await usersService.recordFailedLogin({ ...baseUser, failedLoginCount: 4 } as never);
    const [, data] = repo.update.mock.calls[0];
    expect(data.failedLoginCount).toBe(5);
    expect(data.lockedUntil).toBeInstanceOf(Date);
  });
});

describe("consumeVerificationToken", () => {
  const valid = {
    id: "vt1",
    userId: "u1",
    purpose: TokenPurpose.EMAIL_VERIFY,
    consumedAt: null as Date | null,
    expiresAt: new Date(Date.now() + 60_000),
  };

  it("consumes a valid token and returns the userId", async () => {
    repo.findVerificationByHash.mockResolvedValue({ ...valid });
    const userId = await usersService.consumeVerificationToken("raw", TokenPurpose.EMAIL_VERIFY);
    expect(userId).toBe("u1");
    expect(repo.consumeVerification).toHaveBeenCalledWith("vt1");
  });

  it("rejects an unknown or wrong-purpose token", async () => {
    repo.findVerificationByHash.mockResolvedValue(null);
    expect(await codeOf(usersService.consumeVerificationToken("x", TokenPurpose.EMAIL_VERIFY))).toBe(
      "INVALID_TOKEN",
    );
    repo.findVerificationByHash.mockResolvedValue({ ...valid, purpose: TokenPurpose.PASSWORD_RESET });
    expect(await codeOf(usersService.consumeVerificationToken("x", TokenPurpose.EMAIL_VERIFY))).toBe(
      "INVALID_TOKEN",
    );
  });

  it("rejects an already-used token", async () => {
    repo.findVerificationByHash.mockResolvedValue({ ...valid, consumedAt: new Date() });
    expect(
      await codeOf(usersService.consumeVerificationToken("x", TokenPurpose.EMAIL_VERIFY)),
    ).toBe("TOKEN_USED");
  });

  it("rejects an expired token", async () => {
    repo.findVerificationByHash.mockResolvedValue({ ...valid, expiresAt: new Date(Date.now() - 1) });
    expect(
      await codeOf(usersService.consumeVerificationToken("x", TokenPurpose.EMAIL_VERIFY)),
    ).toBe("TOKEN_EXPIRED");
  });

  it("accepts any of several allowed purposes (invite)", async () => {
    repo.findVerificationByHash.mockResolvedValue({ ...valid, purpose: TokenPurpose.PRO_INVITE });
    const userId = await usersService.consumeVerificationToken("raw", [
      TokenPurpose.STAFF_INVITE,
      TokenPurpose.PRO_INVITE,
    ]);
    expect(userId).toBe("u1");
  });
});

describe("password lifecycle", () => {
  it("reset bumps tokenVersion and revokes all refresh tokens", async () => {
    await usersService.setPasswordAndRevokeSessions("u1", "newhash");
    const [, data] = repo.update.mock.calls[0];
    expect(data.passwordHash).toBe("newhash");
    expect(data.tokenVersion).toEqual({ increment: 1 });
    expect(repo.revokeAllRefreshForUser).toHaveBeenCalledWith("u1");
  });

  it("invite activation sets password, ACTIVE status, and email-verified", async () => {
    await usersService.activateFromInvite("u1", "newhash");
    const [, data] = repo.update.mock.calls[0];
    expect(data.passwordHash).toBe("newhash");
    expect(data.status).toBe(UserStatus.ACTIVE);
    expect(data.emailVerifiedAt).toBeInstanceOf(Date);
  });
});
