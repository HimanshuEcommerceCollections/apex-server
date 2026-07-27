import nodemailer, { type Transporter } from "nodemailer";
import type { EmailMessage, EmailProvider } from "../email.types";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
}

/** SMTP transport (Gmail SMTP for local dev + QA/testing only, docs/architecture/07 #1). */
export class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp";
  private readonly transporter: Transporter;

  constructor(
    cfg: SmtpConfig,
    private readonly from: string,
  ) {
    this.transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: { user: cfg.user, pass: cfg.pass },
    });
  }

  async send(msg: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
  }
}
