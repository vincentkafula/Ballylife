/**
 * Delivers one-time phone codes (verification and "sign in with a code").
 *
 * WhatsApp first: an approved AUTHENTICATION template ("Copy code" button)
 * from Ballylife's WhatsApp number. SMS (Twilio) is the fallback when it's
 * configured. Until the WhatsApp template is approved and no SMS is set up,
 * codes are "not available": the site then doesn't ask anyone for one, so
 * nobody gets stuck waiting for a code that can't be sent.
 *
 * The code itself is never written to our message log.
 */
import { logger } from "../utils/logger";
import { isSmsConfigured, sendVerificationOtp } from "./smsService";

export const OTP_TEMPLATE = "ballylife_verification_code";
export const OTP_MINUTES = 10;

/** "082 123 4567", "+27821234567", "27 82…" -> "27821234567" (South Africa by default). */
export function normalizePhone(input: unknown): string | null {
  let d = String(input ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 && d.startsWith("0")) d = `27${d.slice(1)}`;
  return /^\d{10,15}$/.test(d) ? d : null;
}

/** The ways a number may be stored on a user record. */
export const phoneVariants = (digits: string): string[] =>
  digits.startsWith("27") ? [digits, `+${digits}`, `0${digits.slice(2)}`] : [digits, `+${digits}`];

let whatsappReady = false;
let lastCheck = 0;

/** Whether the WhatsApp code template is approved (checked every 30 minutes). */
export async function refreshOtpReadiness(): Promise<boolean> {
  const { isWhatsAppConfigured } = await import("./whatsapp/client");
  if (!isWhatsAppConfigured() || !process.env.WHATSAPP_WABA_ID?.trim()) { whatsappReady = false; return false; }
  try {
    const { templateStatus } = await import("./whatsapp/setup");
    const t = (await templateStatus()).find(x => x.name === OTP_TEMPLATE);
    const ready = t?.status === "APPROVED";
    if (ready !== whatsappReady) logger.info("otp.whatsapp_readiness", { ready });
    whatsappReady = ready;
  } catch (err) {
    logger.warn("otp.readiness_check_failed", { error: err instanceof Error ? err.message : String(err) });
  }
  lastCheck = Date.now();
  return whatsappReady;
}

export function startOtpReadinessCheck(): void {
  void refreshOtpReadiness();
  setInterval(() => void refreshOtpReadiness(), 30 * 60_000).unref();
}

export const isWhatsAppOtpReady = () => whatsappReady;
/** Can we send phone codes at all right now? (Used to decide whether to ask for one.) */
export const isPhoneOtpAvailable = () => whatsappReady || isSmsConfigured();
/** For tests. */
export function _setWhatsAppOtpReadyForTests(v: boolean) { whatsappReady = v; lastCheck = Date.now(); }

/** Sends a code; returns the channel used. Throws when no channel works. */
export async function deliverCode(phoneInput: string, code: string): Promise<"whatsapp" | "sms"> {
  const phone = normalizePhone(phoneInput);
  if (!phone) throw new Error("Invalid phone number");
  if (whatsappReady) {
    try {
      const { sendTemplate } = await import("./whatsapp/client");
      const wamid = await sendTemplate(phone, OTP_TEMPLATE, [code], { buttonParam: code, logAs: "[verification code]" });
      if (wamid) return "whatsapp";
    } catch (err) {
      logger.warn("otp.whatsapp_failed", { error: err instanceof Error ? err.message : String(err) });
      if (Date.now() - lastCheck > 60_000) void refreshOtpReadiness(); // maybe the template was paused
    }
  }
  if (isSmsConfigured()) {
    const r = await sendVerificationOtp(`+${phone}`, code);
    if (r.sent) return "sms";
  }
  throw new Error("No way to send codes right now");
}
