import { createHash, randomBytes } from "node:crypto";

/** Opaque random token (refresh tokens, verification tokens). Not a JWT. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

/** SHA-256 hex digest. Tokens are stored hashed; the raw value is shown once. */
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
