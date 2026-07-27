import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role, UserStatus } from "../../enums";

const m = vi.hoisted(() => ({
  usersService: {
    findByEmail: vi.fn(),
    createUser: vi.fn(),
    assertNotLocked: vi.fn(),
    recordFailedLogin: vi.fn(),
    resetLoginState: vi.fn(),
    getById: vi.fn(),
    bumpTokenVersion: vi.fn(),
    serialize: vi.fn((u: { id: string }) => ({ id: u.id })),
  },
  usersRepository: {
    findRefreshByHash: vi.fn(),
    createRefreshToken: vi.fn(),
    markRefreshReplaced: vi.fn(),
    revokeFamily: vi.fn(),
    createVerificationToken: vi.fn(),
  },
  verifyPassword: vi.fn(),
}));

vi.mock("../users", () => ({ usersService: m.usersService, usersRepository: m.usersRepository }));
vi.mock("../../utils/password", () => ({
  hashPassword: vi.fn(async () => "hashed"),
  verifyPassword: m.verifyPassword,
}));

import { authService } from "./auth.service";

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { details?: { code?: string } }).details?.code;
  }
}

const future = () => new Date(Date.now() + 60_000);

beforeEach(() => {
  Object.values(m.usersService).forEach((f) => "mockReset" in f && f.mockReset());
  Object.values(m.usersRepository).forEach((f) => f.mockReset());
  m.verifyPassword.mockReset();
  m.usersService.serialize.mockImplementation((u: { id: string }) => ({ id: u.id }));
  m.usersRepository.createRefreshToken.mockResolvedValue({ id: "t2" });
});

describe("refresh — reuse detection", () => {
  it("revokes the family and bumps tokenVersion when a rotated token is replayed", async () => {
    m.usersRepository.findRefreshByHash.mockResolvedValue({
      id: "t1",
      userId: "u1",
      familyId: "f1",
      revokedAt: null,
      replacedById: "tX", // already rotated -> reuse
      expiresAt: future(),
    });

    const code = await codeOf(authService.refresh("raw", {}));
    expect(code).toBe("SESSION_REVOKED");
    expect(m.usersRepository.revokeFamily).toHaveBeenCalledWith("f1");
    expect(m.usersService.bumpTokenVersion).toHaveBeenCalledWith("u1");
  });

  it("rotates within the family for a valid token", async () => {
    m.usersRepository.findRefreshByHash.mockResolvedValue({
      id: "t1",
      userId: "u1",
      familyId: "f1",
      revokedAt: null,
      replacedById: null,
      expiresAt: future(),
    });
    m.usersService.getById.mockResolvedValue({
      id: "u1",
      status: UserStatus.ACTIVE,
      role: Role.CUSTOMER,
      tokenVersion: 0,
    });

    const result = await authService.refresh("raw", {});
    expect(m.usersRepository.markRefreshReplaced).toHaveBeenCalledWith("t1", "t2");
    expect(typeof result.accessToken).toBe("string");
    expect(typeof result.refreshRaw).toBe("string");
    expect(m.usersRepository.revokeFamily).not.toHaveBeenCalled();
  });

  it("rejects an unknown refresh token", async () => {
    m.usersRepository.findRefreshByHash.mockResolvedValue(null);
    expect(await codeOf(authService.refresh("nope", {}))).toBe("INVALID_REFRESH");
  });
});

describe("login", () => {
  const user = {
    id: "u1",
    email: "a@b.com",
    passwordHash: "hashed",
    status: UserStatus.ACTIVE,
    role: Role.CUSTOMER,
    tokenVersion: 0,
    failedLoginCount: 0,
    lockedUntil: null,
  };

  it("records a failed attempt and returns a uniform error on wrong password", async () => {
    m.usersService.findByEmail.mockResolvedValue({ ...user });
    m.verifyPassword.mockResolvedValue(false);
    const code = await codeOf(authService.login({ email: "a@b.com", password: "x" }, {}));
    expect(code).toBe("INVALID_CREDENTIALS");
    expect(m.usersService.recordFailedLogin).toHaveBeenCalled();
  });

  it("establishes a session and resets login state on success", async () => {
    m.usersService.findByEmail.mockResolvedValue({ ...user });
    m.verifyPassword.mockResolvedValue(true);
    const result = await authService.login({ email: "a@b.com", password: "right" }, {});
    expect(m.usersService.resetLoginState).toHaveBeenCalledWith("u1");
    expect(m.usersRepository.createRefreshToken).toHaveBeenCalled();
    expect(typeof result.accessToken).toBe("string");
  });

  it("returns a uniform error for an unknown email (no oracle)", async () => {
    m.usersService.findByEmail.mockResolvedValue(null);
    expect(await codeOf(authService.login({ email: "no@one.com", password: "x" }, {}))).toBe(
      "INVALID_CREDENTIALS",
    );
  });
});
