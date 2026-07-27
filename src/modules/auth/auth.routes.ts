import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { validate } from "../../middleware/validate";
import { authenticate } from "../../middleware/auth";
import { authRateLimiter } from "../../middleware/rate-limit";
import { authController } from "./auth.controller";
import {
  acceptInviteSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from "./auth.validation";

export const authRouter = Router();

authRouter.post(
  "/register",
  authRateLimiter,
  validate({ body: registerSchema }),
  asyncHandler(authController.register),
);

authRouter.post(
  "/login",
  authRateLimiter,
  validate({ body: loginSchema }),
  asyncHandler(authController.login),
);

// Refresh reads the httpOnly cookie + requires the X-Apex-Client header.
authRouter.post("/refresh", asyncHandler(authController.refresh));

// Logout is authenticated (access token) and revokes the refresh family.
authRouter.post("/logout", authenticate, asyncHandler(authController.logout));

// Email flows (public; token-guarded). authRateLimiter throttles abuse/brute-force.
authRouter.post(
  "/verify-email",
  authRateLimiter,
  validate({ body: verifyEmailSchema }),
  asyncHandler(authController.verifyEmail),
);
authRouter.post(
  "/forgot-password",
  authRateLimiter,
  validate({ body: forgotPasswordSchema }),
  asyncHandler(authController.forgotPassword),
);
authRouter.post(
  "/reset-password",
  authRateLimiter,
  validate({ body: resetPasswordSchema }),
  asyncHandler(authController.resetPassword),
);
authRouter.post(
  "/accept-invite",
  authRateLimiter,
  validate({ body: acceptInviteSchema }),
  asyncHandler(authController.acceptInvite),
);
