import rateLimit, { type Options } from "express-rate-limit";
import type { Request, Response } from "express";
import { env } from "../config/env";
import { HttpStatus } from "../constants/http-status";
import { Messages } from "../constants/messages";

const FIFTEEN_MIN = 15 * 60 * 1000;

/** Shared 429 handler emitting the failure envelope (docs/architecture/05). */
function limitHandler(_req: Request, res: Response): void {
  res.status(HttpStatus.TOO_MANY_REQUESTS).json({
    success: false,
    message: Messages.RATE_LIMITED,
    errors: { code: "RATE_LIMITED" },
  });
}

const base: Partial<Options> = {
  standardHeaders: true,
  legacyHeaders: false,
  handler: limitHandler,
};

/** App-wide limiter mounted at /api (env-driven; default 300 — Deviation D-8). */
export const generalRateLimiter = rateLimit({
  ...base,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
});

/** Live price preview — generous ceiling (fires once per selection change). */
export const previewRateLimiter = rateLimit({ ...base, windowMs: FIFTEEN_MIN, limit: 120 });

/** The public form POSTs (bookings, waitlist, pm-requests, pro-applications). */
export const formRateLimiter = rateLimit({ ...base, windowMs: FIFTEEN_MIN, limit: 20 });

/** GET /bookings/:reference — anti-enumeration backstop. */
export const lookupRateLimiter = rateLimit({ ...base, windowMs: FIFTEEN_MIN, limit: 30 });

/** Login/register — credential-stuffing guard (07 §3; keyed on IP only). */
export const authRateLimiter = rateLimit({ ...base, windowMs: FIFTEEN_MIN, limit: 5 });
