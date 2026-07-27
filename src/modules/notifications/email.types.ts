/** A transactional email to deliver. */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/** Provider-agnostic transport (docs/architecture/07 decision #1). */
export interface EmailProvider {
  readonly name: string;
  send(msg: EmailMessage): Promise<void>;
}
