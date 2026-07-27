import type { EmailMessage } from "./email.types";

const BRAND = "Apex Total Home Services";

function layout(heading: string, bodyHtml: string, cta: { label: string; href: string }): string {
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917">
    <div style="max-width:520px;margin:0 auto;padding:32px 24px">
      <h1 style="font-size:20px;margin:0 0 8px">${BRAND}</h1>
      <h2 style="font-size:18px;margin:24px 0 12px">${heading}</h2>
      <div style="font-size:15px;line-height:1.6">${bodyHtml}</div>
      <p style="margin:28px 0">
        <a href="${cta.href}"
           style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">
          ${cta.label}
        </a>
      </p>
      <p style="font-size:12px;color:#78716c">
        If the button doesn't work, paste this link into your browser:<br />
        <a href="${cta.href}" style="color:#0f766e">${cta.href}</a>
      </p>
    </div>
  </body>
</html>`;
}

export function verifyEmailMessage(to: string, link: string): EmailMessage {
  return {
    to,
    subject: `Verify your ${BRAND} account`,
    html: layout(
      "Confirm your email",
      "<p>Welcome! Please confirm your email address to finish setting up your account.</p>",
      { label: "Verify email", href: link },
    ),
    text: `Confirm your ${BRAND} email: ${link}`,
  };
}

export function passwordResetMessage(to: string, link: string): EmailMessage {
  return {
    to,
    subject: `Reset your ${BRAND} password`,
    html: layout(
      "Reset your password",
      "<p>We received a request to reset your password. This link expires in 1 hour. If you didn't ask for this, you can ignore this email.</p>",
      { label: "Reset password", href: link },
    ),
    text: `Reset your ${BRAND} password (expires in 1 hour): ${link}`,
  };
}

export function inviteMessage(to: string, link: string, roleLabel: string): EmailMessage {
  return {
    to,
    subject: `You've been invited to ${BRAND}`,
    html: layout(
      `Set up your ${roleLabel} account`,
      `<p>You've been invited to join ${BRAND} as a <strong>${roleLabel}</strong>. Set a password to activate your account.</p>`,
      { label: "Set password", href: link },
    ),
    text: `Set up your ${BRAND} ${roleLabel} account: ${link}`,
  };
}
