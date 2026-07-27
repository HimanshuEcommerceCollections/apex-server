import { Resend } from "resend";
import type { EmailMessage, EmailProvider } from "../email.types";

/** Production default transport. */
export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async send(msg: EmailMessage): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      ...(msg.text ? { text: msg.text } : {}),
    });
    if (error) throw new Error(`Resend send failed: ${error.message}`);
  }
}
