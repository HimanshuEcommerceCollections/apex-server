import type { z } from "zod";
import type { UserProfile } from "../users/users.types";
import type {
  acceptInviteSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from "./auth.validation";

export type RegisterDto = z.infer<typeof registerSchema>;
export type LoginDto = z.infer<typeof loginSchema>;
export type VerifyEmailDto = z.infer<typeof verifyEmailSchema>;
export type ForgotPasswordDto = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;
export type AcceptInviteDto = z.infer<typeof acceptInviteSchema>;

export interface SessionContext {
  ip?: string;
  userAgent?: string;
}

/** The result of establishing a session: access token (body) + refresh (cookie). */
export interface AuthResult {
  profile: UserProfile;
  accessToken: string;
  refreshRaw: string;
  refreshExpiresAt: Date;
}
