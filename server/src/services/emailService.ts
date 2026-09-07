import nodemailer, { type Transporter } from "nodemailer";

/**
 * Marketplace's own email sender — same discipline as mktPay.ts: ships
 * functional but inactive until real credentials are set, and every
 * call site here goes through this one interface rather than talking to
 * an SMTP library directly.
 *
 * Required env vars to actually send mail:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS — from whichever provider
 *     you choose (SendGrid, Mailgun, AWS SES, Resend's SMTP endpoint,
 *     even a plain Gmail app password for early testing)
 *   EMAIL_FROM — the From: address, e.g. "Ballylife <orders@ballylife.co.za>"
 *
 * Without those, send() logs the email to the console instead of sending
 * it — so nothing in the order/auth flow breaks or throws while email
 * isn't configured yet, it just doesn't reach anyone's inbox. Check the
 * Railway deploy logs for "[email] Would send" lines to see what's not
 * being delivered.
 */

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const EMAIL_FROM = process.env.EMAIL_FROM ?? "Ballylife <no-reply@ballylife.example>";

export function isEmailConfigured(): boolean {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

let transporter: Transporter | null = null;
function getTransporter(): Transporter | null {
  if (!isEmailConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

export interface SendEmailRequest {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(req: SendEmailRequest): Promise<{ sent: boolean; error?: string }> {
  const t = getTransporter();
  if (!t) {
    console.log(`[email] Would send "${req.subject}" to ${req.to} — SMTP not configured, see emailService.ts for required env vars.`);
    return { sent: false, error: "Email is not configured" };
  }
  try {
    await t.sendMail({ from: EMAIL_FROM, to: req.to, subject: req.subject, html: req.html, text: req.text ?? req.html.replace(/<[^>]+>/g, "") });
    return { sent: true };
  } catch (err) {
    console.error("[email] Send failed:", err);
    return { sent: false, error: err instanceof Error ? err.message : "Send failed" };
  }
}

// ── Templated sends used across the app — kept here so every call site
// shares the same subject lines/copy instead of re-writing them inline.
export function sendOrderConfirmationEmail(to: string, orderNumber: string, totalAmount: number, currency: string): Promise<{ sent: boolean; error?: string }> {
  return sendEmail({
    to,
    subject: `Order confirmed — ${orderNumber}`,
    html: `<p>Thanks for your order!</p><p><strong>Order ${orderNumber}</strong><br/>Total: ${currency} ${totalAmount.toFixed(2)}</p><p>You can track your order any time using your order number and this email address.</p>`,
  });
}

export function sendPasswordResetEmail(to: string, resetUrl: string): Promise<{ sent: boolean; error?: string }> {
  return sendEmail({
    to,
    subject: "Reset your Ballylife password",
    html: `<p>We received a request to reset your password.</p><p><a href="${resetUrl}">Click here to set a new password</a> — this link expires in 1 hour.</p><p>If you didn't request this, you can safely ignore this email.</p>`,
  });
}
