import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { verifyAccessToken, type AccessTokenClaims } from "../utils/jwt";
import { ApiError } from "../utils/api-error";
import { Messages } from "../constants/messages";
import { roleHasPermissions, type Permission } from "../constants/roles";
import type { AuthUser } from "../types/common.types";

/**
 * Per-request session guard seam. The access token is stateless, so live
 * revocation (suspend/offboard, refresh-reuse `tokenVersion` bump — 07 §3.1)
 * needs a DB check. The users module registers this at bootstrap; until then,
 * `authenticate` trusts a validly-signed, unexpired token. Returning null means
 * "revoked/suspended" -> 401.
 */
export type SessionGuard = (claims: AccessTokenClaims) => Promise<AuthUser | null>;

let sessionGuard: SessionGuard | null = null;
export function registerSessionGuard(fn: SessionGuard): void {
  sessionGuard = fn;
}

function readBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

async function resolveUser(token: string): Promise<AuthUser> {
  let claims: AccessTokenClaims;
  try {
    claims = verifyAccessToken(token);
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw ApiError.unauthorized("Access token expired", { code: "TOKEN_EXPIRED" });
    }
    throw ApiError.unauthorized("Invalid access token", { code: "INVALID_TOKEN" });
  }
  if (sessionGuard) {
    const fresh = await sessionGuard(claims);
    if (!fresh) throw ApiError.unauthorized("Session revoked", { code: "SESSION_REVOKED" });
    return fresh;
  }
  return { id: claims.sub, role: claims.role, tokenVersion: claims.tokenVersion };
}

/** Require a valid session; attaches `req.user` or throws 401. */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const token = readBearer(req);
  if (!token) {
    next(ApiError.unauthorized(Messages.UNAUTHENTICATED, { code: "UNAUTHENTICATED" }));
    return;
  }
  resolveUser(token)
    .then((user) => {
      req.user = user;
      next();
    })
    .catch(next);
}

/** Attach `req.user` if a valid token is present; otherwise continue anonymously. */
export function optionalAuthenticate(req: Request, _res: Response, next: NextFunction): void {
  const token = readBearer(req);
  if (!token) {
    next();
    return;
  }
  resolveUser(token)
    .then((user) => {
      req.user = user;
      next();
    })
    .catch(() => next());
}

/** Require that `req.user`'s role grants every one of `required`. */
export function authorize(...required: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(ApiError.unauthorized(Messages.UNAUTHENTICATED, { code: "UNAUTHENTICATED" }));
      return;
    }
    if (!roleHasPermissions(req.user.role, required)) {
      next(ApiError.forbidden(Messages.FORBIDDEN, { code: "FORBIDDEN" }));
      return;
    }
    next();
  };
}
