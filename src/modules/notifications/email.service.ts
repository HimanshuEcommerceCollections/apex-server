import { env, isTest } from "../../config/env";
import { logger } from "../../utils/logger";
import type { EmailMessage, EmailProvider } from "./email.types";
import { ConsoleEmailProvider } from "./providers/console.provider";
import { ResendEmailProvider } from "./providers/resend.provider";
import { SmtpEmailProvider } from "./providers/smtp.provider";
import { inviteMessage, passwordResetMessage, verifyEmailMessage } from "./email.templates";

export interface ProviderConfig {
  provider: "resend" | "smtp";
  hasResendKey: boolean;
  hasSmtp: boolean;
}

/**
 * Pure provider selection (testable): honor EMAIL_PROVIDER when its credentials
 * are present, otherwise fall back to the console provider. Swapping providers
 * (SES, Postmark, …) is adding a case here + an implementation — business logic
 * never changes.
 */
export function resolveProviderName(cfg: ProviderConfig): "resend" | "smtp" | "console" {
  if (cfg.provider === "resend" && cfg.hasResendKey) return "resend";
  if (cfg.provider === "smtp" && cfg.hasSmtp) return "smtp";
  return "console";
}

function selectProvider(): EmailProvider {
  if (isTest) return new ConsoleEmailProvider();
  const name = resolveProviderName({
    provider: env.EMAIL_PROVIDER,
    hasResendKey: Boolean(env.RESEND_API_KEY),
    hasSmtp: Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS),
  });
  if (name === "resend") return new ResendEmailProvider(env.RESEND_API_KEY!, env.EMAIL_FROM);
  if (name === "smtp") {
    return new SmtpEmailProvider(
      { host: env.SMTP_HOST!, port: env.SMTP_PORT!, user: env.SMTP_USER!, pass: env.SMTP_PASS! },
      env.EMAIL_FROM,
    );
  }
  logger.warn("EmailService: no provider configured — emails will be logged, not sent (console).");
  return new ConsoleEmailProvider();
}

function link(path: string, token: string): string {
  return `${env.CLIENT_BASE_URL}${path}?token=${encodeURIComponent(token)}`;
}

export class EmailService {
  private readonly provider: EmailProvider;

  constructor() {
    this.provider = selectProvider();
    logger.info(`EmailService provider: ${this.provider.name}`);
  }

  /** Best-effort delivery: a transport hiccup logs but never breaks the request. */
  private async deliver(msg: EmailMessage): Promise<void> {
    try {
      await this.provider.send(msg);
    } catch (err) {
      logger.error(`email delivery failed to ${msg.to}:`, err);
    }
  }

  async sendVerifyEmail(to: string, token: string): Promise<void> {
    await this.deliver(verifyEmailMessage(to, link("/verify-email", token)));
  }

  async sendPasswordReset(to: string, token: string): Promise<void> {
    await this.deliver(passwordResetMessage(to, link("/reset-password", token)));
  }

  async sendInvite(to: string, token: string, roleLabel: string): Promise<void> {
    await this.deliver(inviteMessage(to, link("/accept-invite", token), roleLabel));
  }
}

export const emailService = new EmailService();
