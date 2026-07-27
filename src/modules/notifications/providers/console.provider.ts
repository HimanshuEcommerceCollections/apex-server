import { logger } from "../../../utils/logger";
import type { EmailMessage, EmailProvider } from "../email.types";

/** Dev/test/unconfigured fallback: logs the email instead of sending it. */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";

  async send(msg: EmailMessage): Promise<void> {
    logger.info(`[email:console] to=${msg.to} subject="${msg.subject}"`);
    logger.debug(`[email:console] body:\n${msg.text ?? msg.html}`);
  }
}
