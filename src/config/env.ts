import "dotenv/config";
import { z } from "zod";

/**
 * Validated environment. Importing this module fails fast (process.exit) if any
 * required variable is missing or malformed, so the rest of the app can treat
 * `env` as fully trustworthy and correctly typed.
 *
 * Keys for later phases (Stripe, email) are optional here so the server boots in
 * Phase 0/1 without them; the owning module asserts their presence at point of
 * use (see config/assert-configured.ts helpers per module).
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),

  APP_BASE_URL: z.string().url().default("http://localhost:4000"),
  CLIENT_BASE_URL: z.string().url().default("http://localhost:3000"),

  DATABASE_URL: z.string().url("DATABASE_URL must be a valid Postgres connection string"),

  // Auth (accounts + staff) — 07 §3.
  JWT_ACCESS_SECRET: z.string().min(16, "JWT_ACCESS_SECRET must be at least 16 characters"),
  JWT_REFRESH_SECRET: z.string().min(16, "JWT_REFRESH_SECRET must be at least 16 characters"),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
  MFA_ENC_KEY: z.string().min(16).optional(),

  CORS_ORIGIN: z.string().default("*"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),

  REVALIDATE_SECRET: z.string().optional(),

  // Stripe (Phase 5+) — optional until payments ship.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  /** Bearer token Vercel Cron presents to the abandoned-payment sweep endpoint. */
  CRON_SECRET: z.string().optional(),

  // Email (Phase 2+) — optional until real email ships.
  EMAIL_PROVIDER: z.enum(["resend", "smtp"]).default("smtp"),
  EMAIL_FROM: z.string().default("Apex Total Home Services <no-reply@apexhome.example>"),
  RESEND_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
export const isDev = env.NODE_ENV === "development";
export const isTest = env.NODE_ENV === "test";
