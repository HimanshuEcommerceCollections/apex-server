import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env, isProd, isTest } from "./config/env";
import { apiRouter } from "./routes";
import { errorHandler } from "./middleware/error-handler";
import { notFound } from "./middleware/not-found";
import { generalRateLimiter } from "./middleware/rate-limit";
import { registerSessionGuard } from "./middleware/auth";
import { asyncHandler } from "./utils/async-handler";
import { usersService } from "./modules/users";
import { stripeWebhookHandler } from "./modules/payments";

// Wire the per-request session guard onto `authenticate` (07 §3.1): the access
// token is only honored while the user is ACTIVE and its tokenVersion matches.
registerSessionGuard((claims) => usersService.resolveSession(claims));

/** Build and configure the Express app. Does not start listening. */
export function createApp() {
  const app = express();

  app.disable("x-powered-by");

  // 1. Security headers
  app.use(helmet());

  // 2. CORS. In production CORS_ORIGIN must be explicit origins (browsers reject
  //    wildcard + credentials); "*" is reflected for dev only.
  app.use(
    cors({
      origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(","),
      credentials: true,
    }),
  );

  // 3. Stripe webhook — raw body, BEFORE express.json, top-level (before the /api
  //    rate limiter). Signature-verified + brand-gated inside the handler (07 §6).
  app.post("/webhooks/stripe", express.raw({ type: "application/json" }), asyncHandler(stripeWebhookHandler));

  // 4. Body parsing + cookies (refresh-token cookie — 07 §3)
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // 5. Request logging (quiet during tests)
  if (!isTest) {
    app.use(morgan(isProd ? "combined" : "dev"));
  }

  // 6. Rate limiting + versioned API
  app.use("/api", generalRateLimiter);
  app.use("/api/v1", apiRouter);

  // 7. 404 + error handling (must come last)
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
