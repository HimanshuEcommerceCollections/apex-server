import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env";
import { Role } from "../enums";

/**
 * Access-token claims (docs/architecture/07 §3). The short-lived access JWT is
 * held in memory by the SPA and sent as `Authorization: Bearer`. Refresh tokens
 * are NOT JWTs — they are opaque random strings stored hashed (see the auth
 * module), so this file only handles access tokens.
 */
export interface AccessTokenClaims {
  sub: string; // User.id
  role: Role;
  tokenVersion: number;
  brand: "APEX";
}

export function signAccessToken(claims: AccessTokenClaims): string {
  const options: SignOptions = {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as SignOptions["expiresIn"],
    algorithm: "HS256",
  };
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, options);
}

/** Verify + decode an access token. Throws (JsonWebTokenError/TokenExpiredError) on failure. */
export function verifyAccessToken(token: string): AccessTokenClaims & { iat: number; exp: number } {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenClaims & {
    iat: number;
    exp: number;
  };
}
