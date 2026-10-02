import nodemailer, { type Transporter } from "nodemailer";

/**
 * Marketplace's own email sender — same discipline as mktPay.ts: ships
 * functional but inactive until real credentials are set, and every
 * call site here goes through this one interface rather than talking to
 * an SMTP library directly.
 *
 * Sending, in order of preference:
 *   RESEND_API_KEY — Resend's HTTP API (resend.com). Railway only, never in code.
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS — any SMTP provider, as a fallback.
 *   EMAIL_FROM — the From: address, on a domain verified with the provider,
 *     e.g. "Ballylife <orders@ballylife.com>"
 *   EMAIL_REPLY_TO — optional; where customer replies go (e.g. info@ballylife.com)
 *
 * Without either, send() logs the email to the console instead of sending
 * it — so nothing in the order/auth flow breaks or throws while email
 * isn't configured yet, it just doesn't reach anyone's inbox. Check the
 * Railway deploy logs for "[email] Would send" lines to see what's not
 * being delivered.
 */

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const EMAIL_FROM = process.env.EMAIL_FROM ?? "Ballylife <orders@ballylife.com>";
const REPLY_TO = process.env.EMAIL_REPLY_TO?.trim() || undefined;
const resendKey = () => process.env.RESEND_API_KEY?.trim() || "";

const smtpConfigured = () => Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);

export function isEmailConfigured(): boolean {
  return Boolean(resendKey()) || smtpConfigured();
}

/** Sends through Resend's HTTP API. */
async function sendViaResend(req: SendEmailRequest): Promise<{ sent: boolean; error?: string }> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: EMAIL_FROM, to: [req.to], subject: req.subject, html: req.html,
        text: req.text ?? req.html.replace(/<[^>]+>/g, ""),
        ...(REPLY_TO ? { reply_to: REPLY_TO } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) return { sent: true };
    const j = await res.json().catch(() => ({})) as { message?: string; name?: string };
    // e.g. 403 "The ballylife.com domain is not verified" -- add Resend's DNS records.
    console.error(`[email] Resend refused (HTTP ${res.status}): ${j.message ?? j.name ?? "unknown error"}`);
    return { sent: false, error: j.message ?? `Resend HTTP ${res.status}` };
  } catch (err) {
    console.error("[email] Resend send failed:", err instanceof Error ? err.message : err);
    return { sent: false, error: err instanceof Error ? err.message : "Send failed" };
  }
}

let transporter: Transporter | null = null;
function getTransporter(): Transporter | null {
  if (!smtpConfigured()) return null;
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
  if (resendKey()) return sendViaResend(req);
  const t = getTransporter();
  if (!t) {
    console.log(`[email] Would send "${req.subject}" to ${req.to} — email not configured (set RESEND_API_KEY), see emailService.ts.`);
    return { sent: false, error: "Email is not configured" };
  }
  try {
    await t.sendMail({ from: EMAIL_FROM, to: req.to, subject: req.subject, html: req.html, text: req.text ?? req.html.replace(/<[^>]+>/g, ""), ...(REPLY_TO ? { replyTo: REPLY_TO } : {}) });
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

export function sendVerificationEmail(to: string, verifyUrl: string): Promise<{ sent: boolean; error?: string }> {
  return sendEmail({
    to,
    subject: "Verify your Ballylife account",
    html: `<p>Welcome to Ballylife! Please confirm your email address to activate your account.</p><p><a href="${verifyUrl}">Click here to verify your email</a> — this link expires in 30 minutes.</p><p>If you didn't create this account, you can safely ignore this email.</p>`,
  });
}
